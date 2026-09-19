-- AI-generated longitudinal health insights and change detection (issue #11).

CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  health_parameter_id UUID REFERENCES health_parameters(id) ON DELETE SET NULL,

  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'new_result', 'change_from_previous', 'sustained_trend', 'new_abnormal_flag', 'repeated_abnormal'
  )),
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'attention', 'important')),

  -- Structured evidence IDs (never free-text citations): e.g.
  -- [{"type": "measurement", "id": "..."}, {"type": "report", "id": "..."}]
  evidence JSONB NOT NULL,

  effective_start_date DATE,
  effective_end_date DATE,

  rule_version TEXT NOT NULL DEFAULT 'v1',
  provider TEXT NOT NULL DEFAULT 'heuristic',
  model TEXT,

  -- Groups/dedupes candidates from the same underlying signal, e.g.
  -- "sustained_trend:<health_parameter_id>" or "new_abnormal_flag:<measurement_id>".
  dedup_key TEXT NOT NULL,

  lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'superseded', 'dismissed', 'resolved')),
  superseded_by_insight_id UUID REFERENCES insights(id) ON DELETE SET NULL,

  user_feedback TEXT CHECK (user_feedback IN ('useful', 'not_useful')),

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_user_id ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_dedup_key ON insights(dedup_key);
CREATE INDEX IF NOT EXISTS idx_insights_lifecycle_state ON insights(lifecycle_state);

-- Non-sensitive generation telemetry: rule/algorithm version, provider/model,
-- latency, candidate-to-published outcome. Never health values.
CREATE TABLE IF NOT EXISTS insight_generation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('published', 'suppressed_duplicate', 'no_candidate', 'failed')),
  rule_version TEXT NOT NULL,
  provider TEXT,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
