-- AI extraction and normalization schema (issue #2).
-- Supersedes extracted_parameters (issue #1's raw, unnormalized extraction
-- output) with a canonical parameter registry and structured, provenance-
-- tracked measurements.

CREATE TABLE IF NOT EXISTS health_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('numeric', 'qualitative', 'coded')),
  canonical_unit TEXT,
  display_precision INTEGER,
  coding_system TEXT,
  coding_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parameter_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'builtin' CHECK (source IN ('builtin', 'learned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deliberately no UNIQUE(alias_text): the same wording can plausibly refer to
-- more than one canonical parameter across labs. A lookup that returns more
-- than one distinct health_parameter_id for an alias is what makes a mapping
-- "ambiguous" rather than something to pick arbitrarily.
CREATE INDEX IF NOT EXISTS idx_parameter_aliases_text ON parameter_aliases (lower(alias_text));

CREATE TABLE IF NOT EXISTS unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor DOUBLE PRECISION NOT NULL,
  offset_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (health_parameter_id, from_unit, to_unit)
);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Running' CHECK (status IN ('Running', 'Succeeded', 'Failed')),
  raw_model_output JSONB,
  diagnostics JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_report_id ON extraction_runs(report_id);

CREATE TABLE IF NOT EXISTS measurement_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  page_number INTEGER,
  section_label TEXT,
  raw_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  extraction_run_id UUID REFERENCES extraction_runs(id) ON DELETE SET NULL,
  source_id UUID REFERENCES measurement_sources(id) ON DELETE SET NULL,
  health_parameter_id UUID REFERENCES health_parameters(id) ON DELETE SET NULL,

  -- Raw, as printed on the source report. Always retained.
  raw_test_name TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  raw_unit TEXT,

  value_type TEXT NOT NULL CHECK (value_type IN ('numeric', 'inequality', 'qualitative', 'coded')),
  comparator TEXT CHECK (comparator IN ('<', '<=', '>', '>=')),
  numeric_value DOUBLE PRECISION,
  qualitative_value TEXT,

  normalized_unit TEXT,
  normalized_value DOUBLE PRECISION,

  reference_range_raw TEXT,
  reference_range_context TEXT,
  status_flag TEXT,
  panel_category TEXT,

  sample_datetime TIMESTAMPTZ,
  result_datetime TIMESTAMPTZ,

  extraction_confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  normalization_confidence NUMERIC(4,3),
  ambiguous_candidate_ids UUID[],
  needs_review BOOLEAN NOT NULL DEFAULT false,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,

  duplicate_status TEXT NOT NULL DEFAULT 'none' CHECK (duplicate_status IN ('none', 'suspected', 'confirmed_distinct', 'confirmed_duplicate')),
  duplicate_of_id UUID REFERENCES health_measurements(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_measurements_report_id ON health_measurements(report_id);
CREATE INDEX IF NOT EXISTS idx_health_measurements_parameter_id ON health_measurements(health_parameter_id);
CREATE INDEX IF NOT EXISTS idx_health_measurements_dedup_lookup
  ON health_measurements(health_parameter_id, sample_datetime)
  WHERE is_confirmed = true;

CREATE TABLE IF NOT EXISTS measurement_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES health_measurements(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  corrected_by UUID NOT NULL REFERENCES users(id),
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_corrections_measurement_id ON measurement_corrections(measurement_id);

DROP TABLE IF EXISTS extracted_parameters;
