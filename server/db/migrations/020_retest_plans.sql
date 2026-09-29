-- Retest Radar: a "check again by" date per parameter that needs a recheck,
-- derived by rules (server/src/retest/retestRules.js) from the user's latest
-- confirmed result and any linked medication's onset window. Recomputed on
-- load (like medication_alerts); a plan closes itself ('done') once a newer
-- confirmed result for the parameter arrives.
CREATE TABLE IF NOT EXISTS retest_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  last_measurement_id UUID REFERENCES health_measurements(id) ON DELETE SET NULL,
  flag TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('abnormal_recheck', 'medication_onset')),
  medication_name TEXT,
  micro_action TEXT,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'snoozed', 'dismissed', 'done')),
  snoozed_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retest_plans_user ON retest_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_retest_plans_parameter ON retest_plans(user_id, health_parameter_id);

-- One row per (plan, week) the user ticked this week's micro-action.
CREATE TABLE IF NOT EXISTS retest_checkins (
  plan_id UUID NOT NULL REFERENCES retest_plans(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, week_start)
);

-- Expo push tokens for a user's devices.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- Each reminder is sent at most once per plan, kind and period (the due
-- date for 'two_weeks'/'due', the week start for 'weekly_tip'), so the
-- reminder job can run as often as it likes without repeating itself.
CREATE TABLE IF NOT EXISTS retest_reminders_sent (
  plan_id UUID NOT NULL REFERENCES retest_plans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  period DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, kind, period)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS retest_reminders_enabled BOOLEAN NOT NULL DEFAULT true;
