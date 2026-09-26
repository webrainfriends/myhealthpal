const crypto = require('crypto');
const pool = require('../db/pool');
const { normalizeLanguage } = require('./languageService');

const INVITE_TTL_DAYS = 7;
// No 0/O/1/I/L - codes are read out over the phone to a parent or sibling.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_LENGTH = 8;
const MAX_NAME_LENGTH = 60;
const MAX_RELATION_LENGTH = 30;

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i += 1) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return code;
}

function normalizeInviteCode(code) {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

async function findLink(ownerUserId, memberUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM family_links WHERE owner_user_id = $1 AND member_user_id = $2',
    [ownerUserId, memberUserId]
  );
  return rows[0] || null;
}

// Every profile this account can switch to: itself first, then linked
// members by name.
async function listProfiles(account) {
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name, u.auth_provider, u.preferred_language, fl.relation, fl.access
     FROM family_links fl JOIN users u ON u.id = fl.member_user_id
     WHERE fl.owner_user_id = $1
     ORDER BY u.display_name ASC NULLS LAST, fl.created_at ASC`,
    [account.id]
  );
  return [
    {
      id: account.id,
      displayName: account.display_name,
      relation: null,
      access: 'owner',
      isSelf: true,
      isManaged: false,
      preferredLanguage: account.preferred_language,
    },
    ...rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      relation: row.relation,
      access: row.access,
      isSelf: false,
      isManaged: row.auth_provider === 'managed',
      preferredLanguage: row.preferred_language,
    })),
  ];
}

// Accounts that can see this account's own profile, so a person always
// knows (and can revoke) who has access to their health data.
async function listSharedWith(accountId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name, u.email, fl.access, fl.created_at
     FROM family_links fl JOIN users u ON u.id = fl.owner_user_id
     WHERE fl.member_user_id = $1
     ORDER BY fl.created_at ASC`,
    [accountId]
  );
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    access: row.access,
    since: row.created_at,
  }));
}

async function createManagedProfile(account, { displayName, relation }) {
  const name = cleanText(displayName, MAX_NAME_LENGTH);
  if (!name) {
    const error = new Error('A name is required.');
    error.status = 400;
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A managed profile starts in the caregiver's language (AI summaries,
    // voice readout); it can be changed while acting as that profile.
    const { rows } = await client.query(
      `INSERT INTO users (auth_provider, display_name, preferred_language)
       VALUES ('managed', $1, $2) RETURNING *`,
      [name, account.preferred_language]
    );
    const member = rows[0];
    await client.query(
      `INSERT INTO family_links (owner_user_id, member_user_id, relation, access) VALUES ($1, $2, $3, 'manage')`,
      [account.id, member.id, cleanText(relation, MAX_RELATION_LENGTH)]
    );
    await client.query('COMMIT');
    return member;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateMember(accountId, memberId, { displayName, relation, preferredLanguage }) {
  const link = await findLink(accountId, memberId);
  if (!link) return null;
  if (relation !== undefined) {
    await pool.query('UPDATE family_links SET relation = $3 WHERE owner_user_id = $1 AND member_user_id = $2', [
      accountId,
      memberId,
      cleanText(relation, MAX_RELATION_LENGTH),
    ]);
  }
  // Only a managed profile's name belongs to its caregivers; a real
  // account's name is its own.
  const name = cleanText(displayName, MAX_NAME_LENGTH);
  if (name && link.access === 'manage') {
    await pool.query(`UPDATE users SET display_name = $2 WHERE id = $1 AND auth_provider = 'managed'`, [memberId, name]);
  }
  // The language this person reads/hears AI summaries in (e.g. Dad in
  // Hindi while the caregiver uses English).
  if (preferredLanguage && link.access === 'manage') {
    await pool.query(`UPDATE users SET preferred_language = $2 WHERE id = $1 AND auth_provider = 'managed'`, [
      memberId,
      normalizeLanguage(preferredLanguage),
    ]);
  }
  return findLink(accountId, memberId);
}

// Removes this account's access to a member. A managed profile nobody
// manages any more is deleted outright (with all its data, via ON DELETE
// CASCADE) - otherwise it would be orphaned, unreachable health data.
async function removeMember(accountId, memberId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'DELETE FROM family_links WHERE owner_user_id = $1 AND member_user_id = $2',
      [accountId, memberId]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return { removed: false, deletedProfile: false };
    }
    const { rows } = await client.query(
      `DELETE FROM users u
       WHERE u.id = $1 AND u.auth_provider = 'managed'
         AND NOT EXISTS (SELECT 1 FROM family_links fl WHERE fl.member_user_id = u.id AND fl.access = 'manage')
       RETURNING u.id`,
      [memberId]
    );
    await client.query('COMMIT');
    return { removed: true, deletedProfile: rows.length > 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function revokeSharedWith(accountId, ownerId) {
  const { rowCount } = await pool.query(
    'DELETE FROM family_links WHERE owner_user_id = $1 AND member_user_id = $2',
    [ownerId, accountId]
  );
  return rowCount > 0;
}

// An invite for a profile can come from the profile itself or from anyone
// who manages it - never from a view-only link.
async function createInvite(account, { profileId, access, relation }) {
  const memberId = profileId || account.id;
  if (memberId !== account.id) {
    const link = await findLink(account.id, memberId);
    if (!link || link.access !== 'manage') return null;
  }
  const inviteAccess = access === 'view' ? 'view' : 'manage';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const { rows } = await pool.query(
      `INSERT INTO family_invites (code, member_user_id, created_by_user_id, relation, access, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, access, expires_at`,
      [code, memberId, account.id, cleanText(relation, MAX_RELATION_LENGTH), inviteAccess, String(INVITE_TTL_DAYS)]
    );
    if (rows[0]) return { code: rows[0].code, access: rows[0].access, expiresAt: rows[0].expires_at };
  }
  throw new Error('Could not generate a unique invite code.');
}

// Redeems a code atomically (single use). Returns the linked profile, or an
// { error } the route turns into a 400.
async function redeemInvite(account, rawCode) {
  const code = normalizeInviteCode(rawCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE family_invites SET redeemed_by_user_id = $2, redeemed_at = now()
       WHERE code = $1 AND redeemed_at IS NULL AND expires_at > now() AND member_user_id <> $2
       RETURNING member_user_id, relation, access`,
      [code, account.id]
    );
    const invite = rows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return { error: 'This code is invalid, expired, already used, or is for your own profile.' };
    }
    // Re-redeeming for a profile already linked upgrades view -> manage but
    // never downgrades.
    await client.query(
      `INSERT INTO family_links (owner_user_id, member_user_id, relation, access)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_user_id, member_user_id) DO UPDATE
         SET access = CASE WHEN family_links.access = 'manage' THEN 'manage' ELSE EXCLUDED.access END,
             relation = COALESCE(family_links.relation, EXCLUDED.relation)`,
      [account.id, invite.member_user_id, invite.relation, invite.access]
    );
    await client.query('COMMIT');
    return { memberId: invite.member_user_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findLink,
  listProfiles,
  listSharedWith,
  createManagedProfile,
  updateMember,
  removeMember,
  revokeSharedWith,
  createInvite,
  redeemInvite,
  normalizeInviteCode,
  generateInviteCode,
};
