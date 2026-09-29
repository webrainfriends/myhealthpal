-- AI Workout Coach (issue #135, Phase 1). Camera pose tracking runs on the
-- device; only structured per-rep aggregates and form events reach these
-- tables - no video and no per-frame landmarks are stored. Kept separate
-- from activity_logs (a daily rollup) because a workout is a session with
-- sets and reps of its own.

-- Exercise catalogue as configuration: the app reads pose_rules_json and
-- rep_state_machine_json rather than hard-coding per-exercise UI logic, so
-- a new exercise is a new row.
CREATE TABLE IF NOT EXISTS workout_exercise_definition (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  movement_model_version INTEGER NOT NULL DEFAULT 1,
  pose_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rep_state_machine_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  supported_view_angles TEXT[] NOT NULL DEFAULT '{}',
  met_value NUMERIC(4,1) NOT NULL DEFAULT 4.0,
  is_hold BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES workout_exercise_definition(id),
  exercise_mode TEXT NOT NULL DEFAULT 'selected' CHECK (exercise_mode IN ('selected', 'auto')),
  detection_confidence NUMERIC(4,3),
  target_sets INTEGER NOT NULL CHECK (target_sets BETWEEN 1 AND 20),
  target_reps INTEGER CHECK (target_reps BETWEEN 1 AND 200),
  target_hold_seconds INTEGER CHECK (target_hold_seconds BETWEEN 1 AND 3600),
  target_rest_seconds INTEGER CHECK (target_rest_seconds BETWEEN 0 AND 1800),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  active_seconds INTEGER,
  elapsed_seconds INTEGER,
  estimated_calories_low INTEGER,
  estimated_calories_high INTEGER,
  calorie_confidence TEXT CHECK (calorie_confidence IN ('low', 'moderate', 'high')),
  calorie_method_version TEXT,
  calorie_inputs_json JSONB,
  adherence_json JSONB,
  summary_json JSONB,
  model_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workout_session_user ON workout_session(user_id, created_at DESC);

-- client_id lets the app retry a buffered batch without duplicating rows.
CREATE TABLE IF NOT EXISTS workout_set (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number >= 1),
  target_reps INTEGER,
  completed_valid_reps INTEGER NOT NULL DEFAULT 0,
  attempted_reps INTEGER NOT NULL DEFAULT 0,
  hold_seconds INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rest_seconds_after INTEGER,
  UNIQUE (workout_session_id, client_id)
);

CREATE TABLE IF NOT EXISTS workout_rep (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_set_id UUID NOT NULL REFERENCES workout_set(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  rep_number INTEGER NOT NULL CHECK (rep_number >= 1),
  counted BOOLEAN NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('valid', 'partial', 'invalid')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  range_of_motion_score NUMERIC(4,3),
  posture_score NUMERIC(4,3),
  confidence NUMERIC(4,3),
  metrics_json JSONB,
  UNIQUE (workout_set_id, client_id)
);

CREATE TABLE IF NOT EXISTS workout_form_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  workout_set_id UUID REFERENCES workout_set(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  event_timestamp_ms INTEGER,
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'minor', 'significant', 'reposition')),
  body_side TEXT CHECK (body_side IN ('left', 'right')),
  measured_value NUMERIC(8,2),
  expected_range_json JSONB,
  coaching_message TEXT,
  UNIQUE (workout_session_id, client_id)
);

INSERT INTO workout_exercise_definition (id, name, category, met_value, is_hold, supported_view_angles) VALUES
  ('squat', 'Squat', 'legs', 5.0, FALSE, ARRAY['side', 'front']),
  ('pushup', 'Push-up', 'chest', 8.0, FALSE, ARRAY['side']),
  ('lunge', 'Lunge', 'legs', 4.0, FALSE, ARRAY['side']),
  ('bicep_curl', 'Biceps curl', 'arms', 3.5, FALSE, ARRAY['front', 'side']),
  ('plank', 'Plank', 'core', 3.0, TRUE, ARRAY['side'])
ON CONFLICT (id) DO NOTHING;
