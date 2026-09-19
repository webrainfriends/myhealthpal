-- Longitudinal timeline + AI report summaries (issue #3) and personal
-- dashboard / pinned metrics (issue #4).

-- detected_report_date (issue #1) was a placeholder never populated by any
-- code path; superseded here by report_dates + effective_date, which is
-- actually wired up (see reportDateService).
ALTER TABLE reports DROP COLUMN IF EXISTS detected_report_date;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS date_status TEXT NOT NULL DEFAULT 'Needs Review'
    CHECK (date_status IN ('Confirmed', 'Detected', 'Needs Review')),
  ADD COLUMN IF NOT EXISTS likely_duplicate_of_report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'report_upload';

-- Every date mentioned in or associated with a report, kept independently
-- rather than collapsed into one ambiguous field. `effective_date` on
-- `reports` is a denormalized pointer to whichever of these (if any) was
-- chosen for timeline ordering.
CREATE TABLE IF NOT EXISTS report_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  date_type TEXT NOT NULL CHECK (date_type IN (
    'sample_collection', 'test', 'result', 'report_publication', 'consultation', 'upload'
  )),
  date_value DATE NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'detected' CHECK (source IN ('detected', 'user_confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_dates_report_id ON report_dates(report_id);

-- One logical summary per report; each regeneration appends a new version
-- rather than overwriting, so history/audit is preserved. `reports` doesn't
-- need its own summary column duplicated here — `current_version_id` is the
-- single pointer callers read.
CREATE TABLE IF NOT EXISTS report_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID UNIQUE NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  current_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_summary_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_summary_id UUID NOT NULL REFERENCES report_summaries(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  source_data_version INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE report_summaries
  ADD CONSTRAINT fk_report_summaries_current_version
    FOREIGN KEY (current_version_id) REFERENCES report_summary_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_report_summary_versions_summary_id ON report_summary_versions(report_summary_id);

-- Tracks how many times a report's measurements have materially changed
-- (confirm, correction), so a summary only regenerates when something
-- actually changed.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS data_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_pinned_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  health_parameter_id UUID NOT NULL REFERENCES health_parameters(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, health_parameter_id)
);
