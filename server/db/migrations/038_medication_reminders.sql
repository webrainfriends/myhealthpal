-- Dose-level medication reminders. Entirely independent of lab reports: a
-- reminder runs off the medication's own quantity, number of doses and
-- expiry, and every taken/skipped dose is logged so the person - and a
-- caretaker acting as them, or a sponsor viewing the beneficiary dashboard -
-- can see adherence and how many doses are left.
ALTER TABLE medications ADD COLUMN IF NOT EXISTS total_doses INTEGER CHECK (total_doses IS NULL OR total_doses > 0);
ALTER TABLE medications ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS medication_dose_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  slot TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  logged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medication_id, scheduled_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_dose_logs_user_date ON medication_dose_logs(user_id, scheduled_date);
