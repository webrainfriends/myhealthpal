-- Medication tracking: scanning prescriptions/tablet photos, expiry and
-- refill alerts, auto-association with the existing Health Parameter
-- Registry, and standards-based reference ranges for scoring medication-
-- linked parameters (deliberately separate from a report's own printed
-- reference_range_raw - see reference_ranges below).

CREATE TABLE IF NOT EXISTS medication_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL CHECK (scan_type IN ('prescription', 'tablet_photo')),
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'Uploaded'
    CHECK (ingestion_status IN ('Uploaded', 'Processing', 'Needs Review', 'Completed', 'Failed')),
  processing_error TEXT,
  raw_model_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_scans_user_id ON medication_scans(user_id);

CREATE TABLE IF NOT EXISTS medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES medication_scans(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  generic_name TEXT,
  brand_name TEXT,
  form TEXT CHECK (form IN ('tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler', 'cream', 'other')),

  dosage_amount NUMERIC,
  dosage_unit TEXT CHECK (dosage_unit IN ('mg', 'mcg', 'g', 'ml', 'iu', 'percent', 'other')),

  frequency_per_day NUMERIC,
  times_of_day TEXT[],
  route TEXT,
  instructions TEXT,

  prescribed_for TEXT,
  prescribing_doctor TEXT,

  start_date DATE,
  duration_days INTEGER,
  end_date DATE,

  quantity_dispensed NUMERIC,
  quantity_unit TEXT,
  expiry_date DATE,

  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('prescription_scan', 'tablet_photo', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued')),

  -- Scanned medications start unconfirmed (like health_measurements) so a
  -- user reviews/corrects the AI reading before it drives alerts or
  -- parameter auto-association; a manually entered medication is trusted
  -- immediately.
  extraction_confidence NUMERIC(4,3),
  needs_review BOOLEAN NOT NULL DEFAULT false,
  is_confirmed BOOLEAN NOT NULL DEFAULT true,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_user_id ON medications(user_id);
CREATE INDEX IF NOT EXISTS idx_medications_status ON medications(status);
CREATE INDEX IF NOT EXISTS idx_medications_expiry ON medications(expiry_date);

-- Auto-derived (never hand-picked per user) links from a medication to the
-- Health Parameter Registry entries it's clinically expected to affect or
-- that should be monitored while taking it - populated from a curated,
-- deterministic knowledge base keyed by generic/brand name, the same way
-- extraction results are mapped onto health_parameters via the registry.
CREATE TABLE IF NOT EXISTS medication_parameter_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('monitors_target', 'monitors_side_effect')),
  expected_direction TEXT NOT NULL CHECK (expected_direction IN ('increase', 'decrease', 'stabilize')),
  typical_onset_weeks_min NUMERIC,
  typical_onset_weeks_max NUMERIC,
  rationale TEXT,
  source TEXT NOT NULL DEFAULT 'builtin_knowledge_base',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medication_id, health_parameter_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_medication_parameter_links_medication ON medication_parameter_links(medication_id);
CREATE INDEX IF NOT EXISTS idx_medication_parameter_links_parameter ON medication_parameter_links(health_parameter_id);

-- Deterministic, pull-model alerts (expiry/refill/course), the same
-- lifecycle-stated, dedup-keyed shape as `insights` - no push/background
-- notifications, consistent with the rest of the app.
CREATE TABLE IF NOT EXISTS medication_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('expiring_soon', 'expired', 'refill_needed', 'course_ending', 'course_completed')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'attention', 'important')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  due_date DATE,
  dedup_key TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'dismissed', 'resolved')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_alerts_user_id ON medication_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_medication_alerts_dedup_key ON medication_alerts(dedup_key);
CREATE INDEX IF NOT EXISTS idx_medication_alerts_lifecycle_state ON medication_alerts(lifecycle_state);

-- General-population clinical reference intervals aligned with WHO / ICMR
-- (Indian Council of Medical Research) / FDA-cleared-assay US lab norms,
-- keyed to the existing Health Parameter Registry. Deliberately a separate
-- table from any report's reference_range_raw: the Medications tab always
-- scores a linked parameter against these standards, never against
-- whatever range happened to be printed on the lab report that produced
-- the measurement.
CREATE TABLE IF NOT EXISTS reference_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('who', 'icmr', 'fda')),
  condition_label TEXT NOT NULL DEFAULT 'general',
  range_low DOUBLE PRECISION,
  range_high DOUBLE PRECISION,
  unit TEXT NOT NULL,
  citation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (health_parameter_id, source, condition_label)
);

CREATE INDEX IF NOT EXISTS idx_reference_ranges_parameter ON reference_ranges(health_parameter_id);
