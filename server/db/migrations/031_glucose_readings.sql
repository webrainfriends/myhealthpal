-- Individual glucometer readings (MedM Health / Accu-Chek style "Blood
-- Glucose" exports: one row per finger-prick with a local date & time and a
-- meal context such as Fasting / Before Meal / After Meal / Bedtime).
-- Kept as their own rows - not folded into health_measurements - so the
-- diabetes card can show a per-day average and every reading behind it,
-- and compare that against the last lab report, instead of surfacing only
-- the single latest "Glucose" value. Values are stored in mg/dL (a mmol/L
-- export is converted on import). measured_at is the wall-clock time from
-- the export (meters record local time with no zone), stored as a plain
-- TIMESTAMP so the day a reading belongs to never shifts with the server's
-- timezone.
CREATE TABLE IF NOT EXISTS glucose_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  measured_at TIMESTAMP NOT NULL,
  value_mg_dl NUMERIC NOT NULL CHECK (value_mg_dl > 0),
  meal_context TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, measured_at, value_mg_dl)
);

CREATE INDEX IF NOT EXISTS idx_glucose_readings_user_time ON glucose_readings(user_id, measured_at DESC);
