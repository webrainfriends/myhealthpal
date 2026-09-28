const pool = require('../db/pool');
const config = require('../config');
const { getAiClient, isAllowed } = require('../ai/privacyGateway');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { NUTRIENT_FIELDS } = require('../extraction/providers/nutrientFields');
const {
  computeConsiderations,
  fetchActiveMedications,
  fetchAbnormalDietRelevantLabs,
  SODIUM_DAILY_LIMIT_MG,
  SUGAR_DAILY_LIMIT_G,
  CHOLESTEROL_DAILY_LIMIT_MG,
  IRON_DAILY_TARGET_MG,
  allowedNumbersFromEvidence,
  textOnlyReferencesAllowedNumbers,
} = require('../diet/dietInsightService');

// Cross-checks a diet schedule's planned nutrition against the user's real
// dietary considerations (active medications + abnormal lab results, via
// dietInsightService.computeConsiderations - the exact same considerations
// the pattern-analysis tips and recipe generation already use) and flags
// which of them the schedule would likely worsen vs improve (requirement 2).
// Same cache-with-staleness-check shape as
// dietInsightService.getOrGenerateRecommendations, keyed on schedule_id.

const SAFETY_TAIL =
  ' This is an automated observation based on your planned schedule, not medical or dietary advice - talk to a ' +
  'healthcare professional or dietitian before making a significant change.';

// Only considerations with a directly trackable nutrient get a verdict -
// gout/reflux/thyroid have no corresponding NUTRIENT_FIELDS signal today and
// are left unflagged rather than guessed at.
const CONSIDERATION_METRICS = {
  bloodPressure: { label: 'sodium', unit: 'mg', metricKey: 'avgDailySodiumMg', limit: SODIUM_DAILY_LIMIT_MG, direction: 'lower_is_better' },
  diabetes: { label: 'sugar', unit: 'g', metricKey: 'avgDailySugarG', limit: SUGAR_DAILY_LIMIT_G, direction: 'lower_is_better' },
  cholesterol: { label: 'dietary cholesterol', unit: 'mg', metricKey: 'avgDailyCholesterolMg', limit: CHOLESTEROL_DAILY_LIMIT_MG, direction: 'lower_is_better' },
  ironAbsorption: { label: 'iron', unit: 'mg', metricKey: 'avgDailyIronMg', limit: IRON_DAILY_TARGET_MG, direction: 'higher_is_better' },
};

// Not just "over/under the limit" - a schedule has to clear the limit by a
// real margin (20%) to count as a genuine improve/worsen signal, so a
// schedule sitting right at the guideline isn't flagged either way.
const MARGIN = 0.8;

function classify(metricValue, limit, direction) {
  if (direction === 'lower_is_better') {
    if (metricValue > limit) return 'worsens';
    if (metricValue <= limit * MARGIN) return 'improves';
    return null;
  }
  if (metricValue < limit) return 'worsens';
  if (metricValue >= limit / MARGIN) return 'improves';
  return null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Averages the nutrition of every entry's already-generated recipe across
// the schedule's duration - the planned-diet analog of
// dietInsightService.computeMetrics, which averages *logged* food_entries
// over a rolling window instead of *planned* recipes over a fixed duration.
// Entries still pending/generating/failed recipes simply don't contribute -
// getOrComputeImpactFlags' staleness check recomputes once more finish.
async function computeScheduleAggregate(scheduleId) {
  const { rows } = await pool.query(
    `SELECT s.duration_days, ${NUTRIENT_FIELDS.map((f) => `rs.${f}`).join(', ')}
     FROM diet_schedules s
     JOIN diet_schedule_entries e ON e.schedule_id = s.id
     JOIN recipe_suggestions rs ON rs.id = e.recipe_suggestion_id
     WHERE s.id = $1 AND e.recipe_status = 'generated'`,
    [scheduleId]
  );
  if (rows.length === 0) return null;

  const durationDays = rows[0].duration_days;
  const totals = Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f, 0]));
  for (const row of rows) {
    for (const field of NUTRIENT_FIELDS) totals[field] += Number(row[field]) || 0;
  }

  return {
    entriesWithRecipeCount: rows.length,
    durationDays,
    avgDailyCalories: Math.round(totals.calories / durationDays),
    avgDailySodiumMg: Math.round(totals.sodium_mg / durationDays),
    avgDailySugarG: round1(totals.sugar_g / durationDays),
    avgDailyFiberG: round1(totals.fiber_g / durationDays),
    avgDailyIronMg: round1(totals.iron_mg / durationDays),
    avgDailyCholesterolMg: Math.round(totals.cholesterol_mg / durationDays),
    avgDailyProteinG: round1(totals.protein_g / durationDays),
  };
}

function buildTips(aggregate, considerations) {
  const worsenTips = [];
  const improveTips = [];
  if (!aggregate) return { worsenTips, improveTips };

  for (const consideration of considerations) {
    const metric = CONSIDERATION_METRICS[consideration.key];
    if (!metric) continue;
    const metricValue = aggregate[metric.metricKey];
    const verdict = classify(metricValue, metric.limit, metric.direction);
    if (!verdict) continue;

    const d = { metricValue: round1(metricValue), limit: metric.limit, durationDays: aggregate.durationDays };
    const tip = {
      key: consideration.key,
      label: consideration.label,
      severity: verdict === 'worsens' ? 'important' : 'info',
      title: verdict === 'worsens'
        ? `This schedule may worsen your ${consideration.label}`
        : `This schedule may help your ${consideration.label}`,
      templateData: d,
      heuristicDetail:
        verdict === 'worsens'
          ? `Averaging about ${d.metricValue}${metric.unit} of ${metric.label}/day over this ${d.durationDays}-day ` +
            `schedule is above the general ${d.limit}${metric.unit}/day guideline, which matters given your ` +
            `${consideration.label}-related medication or lab result.`
          : `Averaging about ${d.metricValue}${metric.unit} of ${metric.label}/day over this ${d.durationDays}-day ` +
            `schedule is well within the general ${d.limit}${metric.unit}/day guideline, a good sign given your ` +
            `${consideration.label}-related medication or lab result.`,
    };
    (verdict === 'worsens' ? worsenTips : improveTips).push(tip);
  }

  return { worsenTips, improveTips };
}

async function rephraseWithClaude(client, tip) {
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 250,
    system: [
      'You rephrase one structured diet-schedule impact observation into one or two warm, plain-language sentences.',
      'Use ONLY the numbers and facts given to you. Never introduce a number, food, date, or fact not present in the input.',
      'Never diagnose a condition, and never suggest starting, stopping, or changing a medication or dose.',
    ].join(' '),
    messages: [{ role: 'user', content: JSON.stringify({ type: tip.key, severity: tip.severity, title: tip.title, data: tip.templateData }) }],
  });
  recordAiUsage(FEATURES.DIET_TIPS, response);
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

function publicTip(tip, detail) {
  return { key: tip.key, label: tip.label, severity: tip.severity, title: tip.title, detail };
}

// Same hallucination-guard rephrase pattern as dietInsightService.finalizeTips
// (reusing its exact allowedNumbersFromEvidence/textOnlyReferencesAllowedNumbers
// helpers): a Claude rephrase that mentions a number not traceable to its own
// template data is discarded in favor of the deterministic heuristic sentence.
async function finalizeTips(worsenTips, improveTips, userId) {
  const allTips = [...worsenTips, ...improveTips];
  const heuristicOnly = () => ({
    worsens: worsenTips.map((t) => publicTip(t, `${t.heuristicDetail}${SAFETY_TAIL}`)),
    improves: improveTips.map((t) => publicTip(t, `${t.heuristicDetail}${SAFETY_TAIL}`)),
    provider: 'heuristic',
    model: null,
  });

  if (
    config.dietProvider !== 'claude' ||
    !config.anthropicApiKey ||
    allTips.length === 0 ||
    !(await isAllowed({ subjectUserId: userId, purpose: 'diet_insight' }))
  ) {
    return heuristicOnly();
  }

  const client = await getAiClient({ subjectUserId: userId, purpose: 'diet_insight' });
  let usedClaude = false;

  const finalizeOne = async (tip) => {
    const allowed = allowedNumbersFromEvidence(tip.templateData);
    try {
      const claudeText = await rephraseWithClaude(client, tip);
      if (claudeText && textOnlyReferencesAllowedNumbers(claudeText, allowed)) {
        usedClaude = true;
        return publicTip(tip, `${claudeText}${SAFETY_TAIL}`);
      }
    } catch (err) {
      // Falls through to the heuristic detail below.
    }
    return publicTip(tip, `${tip.heuristicDetail}${SAFETY_TAIL}`);
  };

  const worsens = [];
  for (const tip of worsenTips) worsens.push(await finalizeOne(tip)); // eslint-disable-line no-await-in-loop
  const improves = [];
  for (const tip of improveTips) improves.push(await finalizeOne(tip)); // eslint-disable-line no-await-in-loop

  return { worsens, improves, provider: usedClaude ? 'claude' : 'heuristic', model: usedClaude ? config.anthropicModel : null };
}

async function computeImpactFlags(userId, scheduleId) {
  const [medications, abnormalLabs, aggregate] = await Promise.all([
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
    computeScheduleAggregate(scheduleId),
  ]);
  const considerations = computeConsiderations(medications, abnormalLabs);
  const { worsenTips, improveTips } = buildTips(aggregate, considerations);
  const { worsens, improves, provider, model } = await finalizeTips(worsenTips, improveTips, userId);

  const evidence = {
    aggregate,
    considerations: considerations.map(({ key, label, medicationNames, labFindings }) => ({ key, label, medicationNames, labFindings })),
  };

  return {
    worsens,
    improves,
    evidence,
    provider,
    model,
    entriesWithRecipeCount: aggregate ? aggregate.entriesWithRecipeCount : 0,
  };
}

async function persistImpactFlags(scheduleId, result) {
  const { rows } = await pool.query(
    `INSERT INTO schedule_impact_flags (schedule_id, entries_with_recipe_count, worsens, improves, evidence, provider, model, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (schedule_id) DO UPDATE SET
       entries_with_recipe_count = EXCLUDED.entries_with_recipe_count,
       worsens = EXCLUDED.worsens,
       improves = EXCLUDED.improves,
       evidence = EXCLUDED.evidence,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       generated_at = now(),
       updated_at = now()
     RETURNING *`,
    [scheduleId, result.entriesWithRecipeCount, JSON.stringify(result.worsens), JSON.stringify(result.improves), JSON.stringify(result.evidence), result.provider, result.model]
  );
  return rows[0];
}

async function generateImpactFlags(userId, scheduleId) {
  const result = await computeImpactFlags(userId, scheduleId);
  return persistImpactFlags(scheduleId, result);
}

function isStale(existing, currentCount) {
  if (!existing) return true;
  return existing.entries_with_recipe_count !== currentCount;
}

async function getOrComputeImpactFlags(userId, scheduleId, { forceRefresh = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM schedule_impact_flags WHERE schedule_id = $1', [scheduleId]);
  const existing = rows[0] || null;

  if (!forceRefresh && existing) {
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS count FROM diet_schedule_entries WHERE schedule_id = $1 AND recipe_status = 'generated'`,
      [scheduleId]
    );
    if (!isStale(existing, countRows[0].count)) return existing;
  }

  return generateImpactFlags(userId, scheduleId);
}

module.exports = {
  computeScheduleAggregate,
  computeImpactFlags,
  generateImpactFlags,
  getOrComputeImpactFlags,
};
