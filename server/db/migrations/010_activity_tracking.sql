-- Manual physical-activity logging (steps, exercise minutes, stand hours) -
-- deliberately its own table, never a health_measurements row: it isn't a
-- lab result, has no reference range, and is never "abnormal", so it must
-- never enter organHealthService's score-against-a-range system or the
-- dashboard's "Needs attention" list (which is driven entirely by
-- health_measurements' status_flag/needs_review). One row per user per
-- calendar day.

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  steps INTEGER CHECK (steps IS NULL OR steps >= 0),
  exercise_minutes INTEGER CHECK (exercise_minutes IS NULL OR exercise_minutes >= 0),
  stand_hours INTEGER CHECK (stand_hours IS NULL OR (stand_hours >= 0 AND stand_hours <= 24)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON activity_logs(user_id, log_date DESC);
