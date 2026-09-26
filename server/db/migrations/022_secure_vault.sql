-- Encrypted medical-file vault, consent, and security audit (issue #104).
-- See docs/security/medical-report-security.md.

-- Encryption metadata for every table that stores an uploaded medical
-- file. Only ciphertext lives on disk (ENCRYPTED_STORE_DIR/<storage_object_key>);
-- the per-file data key is stored only wrapped by the key provider (AWS
-- KMS in production). storage_path is deprecated: it's kept only for
-- legacy plaintext rows until scripts/encrypt-legacy-uploads.js migrates
-- them, and is never an authorization decision.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['reports', 'medication_scans', 'diet_scans'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN storage_path DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS encryption_version INTEGER', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS cipher_algorithm TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS storage_object_key TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS encrypted_data_key BYTEA', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS key_provider TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS key_reference TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS key_version TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS cipher_iv BYTEA', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS cipher_auth_tag BYTEA', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS ciphertext_sha256 TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS encrypted_at TIMESTAMPTZ', t);
    -- NULL for rows created encrypted; 'pending' | 'done' | 'missing' for
    -- rows that started as legacy plaintext.
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS legacy_migration_status TEXT', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (storage_object_key) WHERE storage_object_key IS NOT NULL',
                   'idx_' || t || '_storage_object_key', t);
  END LOOP;
END $$;

UPDATE reports SET legacy_migration_status = 'pending'
  WHERE storage_path IS NOT NULL AND encryption_version IS NULL AND legacy_migration_status IS NULL;
UPDATE medication_scans SET legacy_migration_status = 'pending'
  WHERE storage_path IS NOT NULL AND encryption_version IS NULL AND legacy_migration_status IS NULL;
UPDATE diet_scans SET legacy_migration_status = 'pending'
  WHERE storage_path IS NOT NULL AND encryption_version IS NULL AND legacy_migration_status IS NULL;

-- Separate, explicit consent dimensions (never one bundled checkbox). One
-- current row per (user, type); the history lives in security_audit_events.
CREATE TABLE IF NOT EXISTS user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('medical_record_storage', 'ai_document_processing', 'ai_health_insights')),
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'revoked')),
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  -- The signed-in account that made the choice: the person themselves, or a
  -- caregiver acting for a managed family profile.
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_type)
);

-- Security audit trail. No PHI, filenames, tokens or keys - identifiers,
-- event type, purpose and privacy-safe request metadata only. user_id and
-- report_id are intentionally NOT foreign keys, so events outlive the
-- deletions they record.
CREATE TABLE IF NOT EXISTS security_audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  actor_user_id UUID,
  report_id UUID,
  resource_type TEXT,
  event_type TEXT NOT NULL,
  purpose TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  request_id TEXT,
  ip_hash TEXT,
  user_agent_category TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_user ON security_audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_events_report ON security_audit_events(report_id);

-- Append-only: the application can add audit events but never alter or
-- remove them.
CREATE OR REPLACE FUNCTION security_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_security_audit_events_append_only ON security_audit_events;
CREATE TRIGGER trg_security_audit_events_append_only
  BEFORE UPDATE OR DELETE ON security_audit_events
  FOR EACH ROW EXECUTE FUNCTION security_audit_events_append_only();

-- Used download-token ids, for optional single-use file links
-- (DOWNLOAD_TOKEN_SINGLE_USE=true). Rows older than the token TTL are
-- pruned opportunistically.
CREATE TABLE IF NOT EXISTS download_token_uses (
  jti TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
