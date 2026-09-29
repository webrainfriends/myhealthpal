-- Photo attachments for a medication (issue: medication photo storage),
-- plus the prescription-level fields the extractor already reads but
-- medicationScanService.js was discarding (pharmacy/clinic/hospital name
-- and the prescription's own date - see medicationExtractionProvider.js's
-- `document` object).

ALTER TABLE medications ADD COLUMN IF NOT EXISTS prescribing_clinic TEXT;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS prescription_date DATE;

-- Up to MAX_PHOTOS_PER_MEDICATION (routes/medications.js) photos per
-- medication, from either source:
--  - 'scan': the medication was created from a medication_scans row (a
--    prescription or tablet-packaging photo) - rather than duplicating that
--    image's ciphertext once per medicine listed on it, this row carries no
--    encryption columns of its own and is served by decrypting scan_id's
--    own encrypted object instead (see routes/files.js). Deleting the scan
--    deletes these shadow rows too (ON DELETE CASCADE) - the underlying
--    ciphertext is gone with it (routes/medications.js's scan DELETE
--    already removes the encrypted object), so there would be nothing left
--    for them to serve.
--  - 'camera' / 'library' / 'file': a photo taken/picked directly for this
--    medication, encrypted and stored independently the same way a report
--    or medication_scans upload is (security/secureUpload.js).
CREATE TABLE IF NOT EXISTS medication_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES medication_scans(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('scan', 'camera', 'library', 'file')),

  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,

  -- Encryption metadata (security/encryptedFileStore.js's COLUMNS) - NULL
  -- for a 'scan' row that has no independent copy of its own.
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

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_photos_medication ON medication_photos(medication_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_medication_photos_storage_object_key
  ON medication_photos (storage_object_key) WHERE storage_object_key IS NOT NULL;
