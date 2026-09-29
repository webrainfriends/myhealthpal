-- A user's weight-loss goal: current + target weight and an optional
-- target date. One row per user (like diet_recommendations, 004) - a goal
-- is replaced, not accumulated, so an UPSERT via a unique user_id is the
-- right shape, not a history table (that's what health_measurements is
-- for, if/when weight becomes a tracked lab parameter).
--
-- Feeds the AI recipe generator (dietRecipeService.js) as one more real
-- signal alongside abnormal labs, activity, and diet/cuisine preferences -
-- never a clinical value, just a personal target the user set themselves.

CREATE TABLE IF NOT EXISTS user_weight_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_weight_kg NUMERIC(5,1),
  target_weight_kg NUMERIC(5,1),
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_weight_goals_user ON user_weight_goals(user_id);
