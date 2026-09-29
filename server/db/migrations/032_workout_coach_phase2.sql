-- AI Workout Coach Phase 2 (issue #135): tempo, left/right symmetry and
-- workout plans. Additive only - 031 is untouched.

-- Per-rep tempo phases and symmetry (issue #135 §5, §8).
ALTER TABLE workout_rep ADD COLUMN IF NOT EXISTS eccentric_ms INTEGER;
ALTER TABLE workout_rep ADD COLUMN IF NOT EXISTS hold_ms INTEGER;
ALTER TABLE workout_rep ADD COLUMN IF NOT EXISTS concentric_ms INTEGER;
ALTER TABLE workout_rep ADD COLUMN IF NOT EXISTS symmetry_score NUMERIC(4,3);

-- Planned tempo (seconds per phase). NULL = no tempo target.
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS target_tempo_down_seconds NUMERIC(3,1) CHECK (target_tempo_down_seconds BETWEEN 0 AND 20);
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS target_tempo_pause_seconds NUMERIC(3,1) CHECK (target_tempo_pause_seconds BETWEEN 0 AND 20);
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS target_tempo_up_seconds NUMERIC(3,1) CHECK (target_tempo_up_seconds BETWEEN 0 AND 20);

-- A saved plan is an ordered list of exercises with their targets. Running a
-- plan creates one workout_session per exercise, grouped by plan_run_id.
CREATE TABLE IF NOT EXISTS workout_plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workout_plan_user ON workout_plan(user_id);

CREATE TABLE IF NOT EXISTS workout_plan_exercise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_plan_id UUID NOT NULL REFERENCES workout_plan(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES workout_exercise_definition(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  target_sets INTEGER NOT NULL CHECK (target_sets BETWEEN 1 AND 20),
  target_reps INTEGER CHECK (target_reps BETWEEN 1 AND 200),
  target_hold_seconds INTEGER CHECK (target_hold_seconds BETWEEN 1 AND 3600),
  target_rest_seconds INTEGER CHECK (target_rest_seconds BETWEEN 0 AND 1800),
  target_tempo_down_seconds NUMERIC(3,1) CHECK (target_tempo_down_seconds BETWEEN 0 AND 20),
  target_tempo_pause_seconds NUMERIC(3,1) CHECK (target_tempo_pause_seconds BETWEEN 0 AND 20),
  target_tempo_up_seconds NUMERIC(3,1) CHECK (target_tempo_up_seconds BETWEEN 0 AND 20),
  UNIQUE (workout_plan_id, sequence)
);

ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS workout_plan_id UUID REFERENCES workout_plan(id) ON DELETE SET NULL;
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS plan_run_id UUID;
CREATE INDEX IF NOT EXISTS idx_workout_session_plan_run ON workout_session(plan_run_id) WHERE plan_run_id IS NOT NULL;
