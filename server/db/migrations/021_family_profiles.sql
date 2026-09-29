-- Family Health Eye: one signed-in account looking after other people's
-- health (typically an adult child and their parents).
--
-- Every family member is an ordinary users row, so every existing table and
-- route (reports, measurements, insights, medications, retest plans, chat,
-- ...) already scopes their data correctly. A signed-in account acts as a
-- linked profile by sending X-Profile-Id, which requireAuth only honors
-- when a family_links row grants it (middleware/auth.js).
--
-- Two kinds of member:
--  * 'managed' profiles: created by a caregiver for someone who won't use
--    the app themselves. They have no sign-in of their own.
--  * real accounts: a person shares their own profile with a family member
--    by invite code.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('guest', 'google', 'apple', 'managed'));

CREATE TABLE IF NOT EXISTS family_links (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation TEXT,
  -- 'manage': may upload, confirm, edit and delete on the member's behalf.
  -- 'view': read-only (every non-GET request is refused).
  access TEXT NOT NULL DEFAULT 'manage' CHECK (access IN ('manage', 'view')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, member_user_id),
  CHECK (owner_user_id <> member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_family_links_member ON family_links(member_user_id);

-- Single-use, short-lived codes that grant another account access to a
-- profile. Created by the profile itself or anyone who manages it.
CREATE TABLE IF NOT EXISTS family_invites (
  code TEXT PRIMARY KEY,
  member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation TEXT,
  access TEXT NOT NULL CHECK (access IN ('manage', 'view')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
