-- Sponsors vs caretakers. A family_links row is directional: the owner sees
-- the member, never the other way round, and never another member's data -
-- so a beneficiary can not see their sponsor/caretaker, and a caretaker only
-- ever reaches the people tagged to them (a sponsor's data is reachable only
-- if that sponsor is also tagged to the caretaker).
--
--  * 'caretaker': the existing behaviour - may act as the member's profile
--    (X-Profile-Id), with 'manage' or 'view' access.
--  * 'sponsor': pays for the member's insurance / care. Sees only the
--    beneficiary summary dashboard (GET /api/family/dashboard), never the
--    member's full records, and can never act as the profile - so the link is
--    always read-only ('view').
ALTER TABLE family_links ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'caretaker';
ALTER TABLE family_links DROP CONSTRAINT IF EXISTS family_links_role_check;
ALTER TABLE family_links ADD CONSTRAINT family_links_role_check CHECK (role IN ('caretaker', 'sponsor'));
ALTER TABLE family_links DROP CONSTRAINT IF EXISTS family_links_sponsor_view_only;
ALTER TABLE family_links ADD CONSTRAINT family_links_sponsor_view_only CHECK (role = 'caretaker' OR access = 'view');

ALTER TABLE family_invites ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'caretaker';
ALTER TABLE family_invites DROP CONSTRAINT IF EXISTS family_invites_role_check;
ALTER TABLE family_invites ADD CONSTRAINT family_invites_role_check CHECK (role IN ('caretaker', 'sponsor'));
ALTER TABLE family_invites DROP CONSTRAINT IF EXISTS family_invites_sponsor_view_only;
ALTER TABLE family_invites ADD CONSTRAINT family_invites_sponsor_view_only CHECK (role = 'caretaker' OR access = 'view');
