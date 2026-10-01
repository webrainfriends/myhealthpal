-- OAuth 2.1 authorization server for the remote MCP connector (Claude /
-- ChatGPT). Deliberately separate from the app's own 180-day session JWT:
-- connector access tokens are short-lived, scoped, per-client and revocable.
-- Only SHA-256 hashes of codes/tokens are stored, never the values.

-- Dynamically registered clients (RFC 7591). Public clients only (PKCE).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per "this account authorised this client for these scopes".
-- Revoking it kills every token issued under it.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_user ON oauth_grants (user_id) WHERE revoked_at IS NULL;

-- Single-use authorization codes (PKCE S256 challenge bound to the code).
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

-- Access (about 1h) and refresh (rotating) tokens.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens (grant_id);

-- The data subject's explicit choice to let an external AI app (Claude,
-- ChatGPT) read/act on their records through the connector.
ALTER TABLE user_consents DROP CONSTRAINT IF EXISTS user_consents_consent_type_check;
ALTER TABLE user_consents ADD CONSTRAINT user_consents_consent_type_check
  CHECK (consent_type IN ('medical_record_storage', 'ai_document_processing', 'ai_health_insights', 'external_ai_connector'));
