-- One row per Claude API call, attributed to the signed-in user and the
-- sign-in session that triggered it (see lib/requestContext.js). This is
-- the raw ledger behind Settings > AI usage and the operator-side
-- `npm run ai-usage-report` - the data needed to size per-user plans and a
-- commercial cost model, rather than guessing from the Anthropic bill.
--
-- estimated_cost_usd is computed at insert time from the price table in
-- aiUsageService.js, so a later price change never silently rewrites what
-- past usage cost. user_id is ON DELETE SET NULL, not CASCADE: once an
-- account is deleted its rows keep no identity, but the spend they
-- represent still happened and still belongs in aggregate cost totals.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created ON ai_usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_session ON ai_usage_events(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created ON ai_usage_events(created_at);
