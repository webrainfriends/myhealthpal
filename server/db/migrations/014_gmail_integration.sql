-- Gmail integration (issue #54): lets a user connect their Gmail account so
-- MyHealthPal can search for likely health-related emails and import
-- selected attachments through the existing report ingestion pipeline.
--
-- One connection per user (unique user_id) - sync-state fields (mode,
-- checkpoint, last error) live on the same row rather than a separate
-- GmailSyncState table, since there is never more than one Gmail account
-- connected per user and a second table would only add joins with no
-- independent lifecycle of its own.
CREATE TABLE IF NOT EXISTS gmail_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider_account_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  scopes TEXT NOT NULL,
  -- AES-256-GCM ciphertext (iv || authTag || ciphertext, base64) - never the
  -- raw refresh token. NULL once disconnected/revoked.
  encrypted_refresh_token TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reauth_required', 'disconnected')),
  sync_mode TEXT NOT NULL DEFAULT 'manual' CHECK (sync_mode IN ('manual', 'auto')),
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  -- The received-date checkpoint a search/sync resumes from - not a Gmail
  -- historyId, which needs push/pull history-list plumbing this MVP's
  -- on-demand search doesn't have; a date checkpoint is enough to avoid
  -- re-scanning the whole mailbox on every call.
  last_sync_checkpoint TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provenance for every Gmail attachment imported into `reports` - what it
-- was found as (Gmail's own ids), where it came from (sender/subject/
-- received date, never the email body), and dedup keys (ids + content
-- checksum) so re-running a search/import never creates a second report
-- for the same attachment.
CREATE TABLE IF NOT EXISTS gmail_document_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES gmail_connections(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  provider_attachment_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  sender TEXT,
  subject TEXT,
  received_at TIMESTAMPTZ,
  original_filename TEXT,
  mime_type TEXT,
  imported_report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_message_id, provider_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_document_sources_user_checksum ON gmail_document_sources(user_id, checksum);
CREATE INDEX IF NOT EXISTS idx_gmail_document_sources_user_id ON gmail_document_sources(user_id);

-- Audit trail for Gmail account connection, disconnection, search, import
-- and sync activity - `detail` never contains OAuth tokens, email bodies or
-- attachment content, only operational metadata (counts, message/attachment
-- ids, error categories).
CREATE TABLE IF NOT EXISTS integration_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES gmail_connections(id) ON DELETE SET NULL,
  integration TEXT NOT NULL DEFAULT 'gmail',
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_log_user_id ON integration_audit_log(user_id);
