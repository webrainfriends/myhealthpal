-- Guest accounts plus optional Google/Apple sign-in. Every other table
-- already scopes its data by reports.user_id (or a table hanging off it)
-- via foreign keys, so isolating one user's data from another only ever
-- required correctly establishing *which* user_id a request belongs to -
-- previously a client-supplied "x-user-id" header, trusted outright, which
-- let any caller read/write as any other user by simply setting it. This
-- migration is the schema half of replacing that with verified sessions.

-- Guests have no email; account identity for Google/Apple is
-- (auth_provider, provider_user_id) below, not email, since two different
-- providers can plausibly report the same address for the same person -
-- email becomes informational/display data rather than the identity key.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'guest'
  CHECK (auth_provider IN ('guest', 'google', 'apple'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- One account per (provider, provider-issued id). Guest rows never set
-- provider_user_id, and Postgres never treats two NULLs as equal in a
-- unique index, so any number of guest accounts coexist under this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_identity
  ON users(auth_provider, provider_user_id) WHERE provider_user_id IS NOT NULL;
