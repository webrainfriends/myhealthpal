-- Apple Watch / Wear OS companion apps. A watch signs in without a password:
-- it asks for a short pairing code, the signed-in phone approves it, and the
-- watch then collects a scoped, revocable token (see routes/watch.js). Only
-- SHA-256 hashes of the code and poll secret are stored. Each row is both the
-- pairing request and, once approved, the device record the user can revoke.
CREATE TABLE IF NOT EXISTS watch_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('watchos', 'wearos')),
  code_hash TEXT NOT NULL,
  poll_secret_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  token_issued_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A code can only be pending once at a time, so entering it finds one watch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_pairings_pending_code
  ON watch_pairings (code_hash) WHERE approved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watch_pairings_user
  ON watch_pairings (user_id) WHERE revoked_at IS NULL;

-- Watches re-send a log after a dropped connection; a client-generated id makes
-- the retry a no-op instead of a double entry.
ALTER TABLE water_entries ADD COLUMN IF NOT EXISTS client_entry_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_entries_client_entry
  ON water_entries (user_id, client_entry_id) WHERE client_entry_id IS NOT NULL;
