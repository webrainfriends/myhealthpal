-- AI Workout Coach Phase 4 (issue #135): heart rate and device energy.
-- Additive only. Heart-rate samples arrive from the phone's health store
-- (Apple Health / Health Connect, which also carries Samsung Health data)
-- only when the user opts in for a workout; they are stored downsampled with
-- the session so the calorie estimate can be recomputed later.

ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS target_hr_zone_low INTEGER CHECK (target_hr_zone_low BETWEEN 40 AND 220);
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS target_hr_zone_high INTEGER CHECK (target_hr_zone_high BETWEEN 40 AND 230);
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS hr_json JSONB;
ALTER TABLE workout_session ADD COLUMN IF NOT EXISTS device_active_kcal INTEGER;

ALTER TABLE workout_plan_exercise ADD COLUMN IF NOT EXISTS target_hr_zone_low INTEGER CHECK (target_hr_zone_low BETWEEN 40 AND 220);
ALTER TABLE workout_plan_exercise ADD COLUMN IF NOT EXISTS target_hr_zone_high INTEGER CHECK (target_hr_zone_high BETWEEN 40 AND 230);
