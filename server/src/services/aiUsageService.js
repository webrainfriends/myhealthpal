const pool = require('../db/pool');
const config = require('../config');
const { getContext } = require('../lib/requestContext');

// USD per 1M tokens, Anthropic first-party API list prices. Cache writes
// (5-minute TTL) bill at 1.25x input and cache reads at 0.1x input unless a
// model lists its own rate. Only used for an *estimate* shown to the user
// and in the operator report - the Anthropic invoice stays the source of
// truth. Override or extend with AI_PRICING_JSON (see config.js) when list
// prices change or a new model is configured, without a code change.
const DEFAULT_PRICING = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Stable identifiers for every place the server calls Claude - what the
// per-feature breakdown in Settings > AI usage groups by.
const FEATURES = {
  REPORT_EXTRACTION: 'report_extraction',
  REPORT_SUMMARY: 'report_summary',
  CHAT: 'chat',
  CUSTOM_CARDS: 'custom_cards',
  MEDICATION_SCAN: 'medication_scan',
  MEDICATION_KNOWLEDGE: 'medication_knowledge',
  DIET_PHOTO: 'diet_photo',
  DIET_TEXT: 'diet_text',
  DIET_TIPS: 'diet_tips',
  RECIPES: 'recipes',
};

function pricingTable() {
  return { ...DEFAULT_PRICING, ...(config.aiPricingOverrides || {}) };
}

// Longest-prefix match so a dated or suffixed model id (e.g. an
// "...-20260101" snapshot) still resolves to its family's price, and
// "claude-opus-5-5" never falls through to "claude-opus-5".
function pricingFor(model) {
  if (!model) return null;
  const table = pricingTable();
  if (table[model]) return table[model];
  const key = Object.keys(table)
    .filter((candidate) => model.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return key ? table[key] : null;
}

function normalizeUsage(usage) {
  return {
    inputTokens: Number(usage?.input_tokens) || 0,
    outputTokens: Number(usage?.output_tokens) || 0,
    cacheCreationInputTokens: Number(usage?.cache_creation_input_tokens) || 0,
    cacheReadInputTokens: Number(usage?.cache_read_input_tokens) || 0,
  };
}

// An unknown model costs 0 rather than a guess - the token counts are
// still recorded, so the cost can be recomputed once a price is added.
function estimateCostUsd(model, tokens) {
  const price = pricingFor(model);
  if (!price) return 0;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cost =
    (tokens.inputTokens * price.input +
      tokens.outputTokens * price.output +
      tokens.cacheCreationInputTokens * cacheWrite +
      tokens.cacheReadInputTokens * cacheRead) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// Called right after every Claude response. Never throws and is never
// awaited on the hot path by callers that don't need to: a failed ledger
// insert must not turn a successful AI answer into an error for the user.
// userId/sessionId default to the current request's (requestContext.js);
// pass them explicitly only for work running outside any request.
function recordAiUsage(feature, response, { userId, sessionId } = {}) {
  if (!response?.usage) return Promise.resolve(null);
  const context = getContext();
  const tokens = normalizeUsage(response.usage);
  const model = response.model || config.anthropicModel;
  const cost = estimateCostUsd(model, tokens);
  return pool
    .query(
      `INSERT INTO ai_usage_events
         (user_id, session_id, feature, model, input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, estimated_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId ?? context.userId ?? null,
        sessionId ?? context.sessionId ?? null,
        feature,
        model,
        tokens.inputTokens,
        tokens.outputTokens,
        tokens.cacheCreationInputTokens,
        tokens.cacheReadInputTokens,
        cost,
      ]
    )
    .then(({ rows }) => rows[0]?.id ?? null)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Failed to record AI usage for ${feature}:`, err.message);
      return null;
    });
}

const TOTALS_SELECT = `
  COUNT(*)::int AS requests,
  COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(SUM(cache_creation_input_tokens), 0)::bigint AS cache_write_tokens,
  COALESCE(SUM(cache_read_input_tokens), 0)::bigint AS cache_read_tokens,
  COALESCE(SUM(estimated_cost_usd), 0)::float8 AS estimated_cost_usd`;

function mapTotals(row) {
  const inputTokens = Number(row?.input_tokens) || 0;
  const outputTokens = Number(row?.output_tokens) || 0;
  const cacheWriteTokens = Number(row?.cache_write_tokens) || 0;
  const cacheReadTokens = Number(row?.cache_read_tokens) || 0;
  return {
    requests: Number(row?.requests) || 0,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
    estimatedCostUsd: Math.round((Number(row?.estimated_cost_usd) || 0) * 1_000_000) / 1_000_000,
  };
}

async function getUserUsageSummary(userId, { days = 30, currentSessionId = null, sessionLimit = 10 } = {}) {
  const [period, allTime, byFeature, byDay, bySession, currentSession] = await Promise.all([
    pool.query(
      `SELECT ${TOTALS_SELECT} FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)`,
      [userId, days]
    ),
    pool.query(`SELECT ${TOTALS_SELECT} FROM ai_usage_events WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT feature, ${TOTALS_SELECT} FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY feature ORDER BY SUM(estimated_cost_usd) DESC, COUNT(*) DESC`,
      [userId, days]
    ),
    pool.query(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, ${TOTALS_SELECT} FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY created_at::date ORDER BY created_at::date`,
      [userId, days]
    ),
    pool.query(
      `SELECT session_id, MIN(created_at) AS first_used_at, MAX(created_at) AS last_used_at, ${TOTALS_SELECT}
       FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY session_id ORDER BY MAX(created_at) DESC LIMIT $3`,
      [userId, days, sessionLimit]
    ),
    currentSessionId
      ? pool.query(`SELECT ${TOTALS_SELECT} FROM ai_usage_events WHERE user_id = $1 AND session_id = $2`, [
          userId,
          currentSessionId,
        ])
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    periodDays: days,
    period: mapTotals(period.rows[0]),
    allTime: mapTotals(allTime.rows[0]),
    currentSession: { sessionId: currentSessionId, ...mapTotals(currentSession.rows[0]) },
    byFeature: byFeature.rows.map((row) => ({ feature: row.feature, ...mapTotals(row) })),
    byDay: byDay.rows.map((row) => ({ day: row.day, ...mapTotals(row) })),
    bySession: bySession.rows.map((row) => ({
      sessionId: row.session_id,
      isCurrent: currentSessionId != null && row.session_id === currentSessionId,
      firstUsedAt: row.first_used_at,
      lastUsedAt: row.last_used_at,
      ...mapTotals(row),
    })),
  };
}

// Operator-side view across every account - backs scripts/ai-usage-report.js.
// Not exposed over HTTP: there is no admin role, and one user's usage is
// never visible to another.
async function getAllUsersUsageReport({ days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT e.user_id, u.email, u.auth_provider, ${TOTALS_SELECT},
            COUNT(DISTINCT e.session_id)::int AS sessions
     FROM ai_usage_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.created_at >= now() - make_interval(days => $1)
     GROUP BY e.user_id, u.email, u.auth_provider
     ORDER BY SUM(e.estimated_cost_usd) DESC`,
    [days]
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    authProvider: row.auth_provider,
    sessions: Number(row.sessions) || 0,
    ...mapTotals(row),
  }));
}

module.exports = {
  FEATURES,
  DEFAULT_PRICING,
  pricingFor,
  estimateCostUsd,
  normalizeUsage,
  recordAiUsage,
  getUserUsageSummary,
  getAllUsersUsageReport,
};
