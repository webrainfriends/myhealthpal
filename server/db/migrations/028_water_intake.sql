-- Water intake tracking: a simple per-entry log (250ml/500ml/1L/2L quick-add
-- buttons on the client, but any positive amount is accepted server-side)
-- plus a cached, AI-assisted daily min/ideal/max target. Mirrors
-- 012_diet_tracking.sql's food_entries (a plain log table) and
-- diet_recommendations (a cache-with-staleness-check table for a computed,
-- explained number) - the two established shapes this feature reuses.

CREATE TABLE IF NOT EXISTS water_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_ml INTEGER NOT NULL CHECK (amount_ml > 0 AND amount_ml <= 5000),
  logged_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_water_entries_user_logged ON water_entries(user_id, logged_at);

-- One cached target per user (waterTargetService.js), the same
-- upsert-by-user_id + staleness-check shape diet_recommendations uses.
-- Recomputed when the person's recorded weight changes or once per day
-- (computed_date) - there's no cheap "has anything relevant changed" signal
-- the way diet_recommendations has entries_analyzed_count, so a daily
-- refresh is the simplest correct staleness rule (medications/labs/weight
-- rarely change more than once a day in practice).
CREATE TABLE IF NOT EXISTS water_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  min_ml INTEGER NOT NULL,
  ideal_ml INTEGER NOT NULL,
  max_ml INTEGER NOT NULL,

  weight_kg_considered NUMERIC(5,1),
  computed_date DATE NOT NULL,

  summary TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL DEFAULT 'heuristic',
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same boolean-toggle shape as retest_reminders_enabled
-- (020_retest_plans.sql) - a daily local nudge to log water, synced by
-- mobile/src/notifications/waterNotifications.js the same way
-- syncLocalRetestReminders handles the retest reminder toggle.
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_reminders_enabled BOOLEAN NOT NULL DEFAULT true;
