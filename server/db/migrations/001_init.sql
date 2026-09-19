-- MyHealthPal ingestion schema

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  upload_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_report_date DATE,
  source_provider TEXT,
  report_type TEXT,
  ingestion_status TEXT NOT NULL DEFAULT 'Uploaded'
    CHECK (ingestion_status IN ('Uploaded', 'Processing', 'Needs Review', 'Completed', 'Failed')),
  extraction_status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (extraction_status IN ('Pending', 'Text Extracted', 'OCR Pending', 'OCR Extracted', 'Failed')),
  validation_status TEXT NOT NULL DEFAULT 'Valid'
    CHECK (validation_status IN ('Valid', 'Invalid')),
  validation_error TEXT,
  processing_error TEXT,
  generated_summary TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(ingestion_status);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Queued'
    CHECK (status IN ('Queued', 'Running', 'Succeeded', 'Failed')),
  attempt INTEGER NOT NULL DEFAULT 1,
  content_kind TEXT CHECK (content_kind IN ('text_native', 'image_scanned', 'structured_table', 'mixed')),
  diagnostics JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_report_id ON ingestion_jobs(report_id);

CREATE TABLE IF NOT EXISTS extracted_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  test_name TEXT NOT NULL,
  value TEXT NOT NULL,
  numeric_value DOUBLE PRECISION,
  unit TEXT,
  reference_range TEXT,
  status_flag TEXT,
  param_date DATE,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  raw_source_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extracted_parameters_report_id ON extracted_parameters(report_id);
