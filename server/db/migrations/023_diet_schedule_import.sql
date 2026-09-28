-- Staging table for importing a diet schedule from an uploaded document
-- (PDF/DOCX/XLSX/CSV/photo) - the diet-schedule analog of `reports`/
-- `diet_scans`. A new table (not an ALTER onto diet_scans) since a diet
-- schedule import produces multiple days/meals worth of entries rather than
-- one scan's worth of food items, and carries its own requested duration/
-- start date the person picks before uploading.
--
-- Encrypted-at-rest the same way every other uploaded medical/health
-- document is (security/encryptedFileStore.js) - this is a new table, so it
-- gets the encryption columns directly rather than via the ALTER-based
-- backfill 022_secure_vault.sql used for tables that predate encryption.

CREATE TABLE IF NOT EXISTS diet_schedule_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,

  encryption_version INTEGER,
  cipher_algorithm TEXT,
  storage_object_key TEXT,
  encrypted_data_key BYTEA,
  key_provider TEXT,
  key_reference TEXT,
  key_version TEXT,
  cipher_iv BYTEA,
  cipher_auth_tag BYTEA,
  ciphertext_sha256 TEXT,
  encrypted_at TIMESTAMPTZ,

  -- Picked by the person before uploading - the schedule this import will
  -- become is created with exactly this duration/start date; the extraction
  -- provider is told the requested duration but must still only report
  -- entries actually legible in the document (see dietScheduleExtractionProvider.js).
  requested_duration_days INTEGER NOT NULL CHECK (requested_duration_days IN (7, 15)),
  requested_start_date DATE NOT NULL,

  ingestion_status TEXT NOT NULL DEFAULT 'Uploaded'
    CHECK (ingestion_status IN ('Uploaded', 'Processing', 'Needs Review', 'Completed', 'Failed')),
  processing_error TEXT,
  raw_model_output JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diet_schedule_imports_user ON diet_schedule_imports(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_diet_schedule_imports_storage_object_key
  ON diet_schedule_imports (storage_object_key) WHERE storage_object_key IS NOT NULL;
