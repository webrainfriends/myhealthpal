const crypto = require('crypto');
const pool = require('../db/pool');
const authService = require('./authService');

// Pairing for the Apple Watch / Wear OS companion apps (migration 042).
//   1. The watch calls start() and shows the 6-digit code.
//   2. The user types the code into the phone app, which calls confirm().
//   3. The watch polls poll() and receives a scoped token exactly once.
// Hashes only are stored, so a database read never reveals a usable code or
// poll secret.

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_WATCHES = 5;
const PLATFORMS = new Set(['watchos', 'wearos']);

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function cleanDeviceName(name, platform) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  return trimmed || (platform === 'watchos' ? 'Apple Watch' : 'Wear OS watch');
}

async function startPairing({ deviceName, platform } = {}) {
  if (!PLATFORMS.has(platform)) throw httpError("platform must be 'watchos' or 'wearos'.", 400);
  const name = cleanDeviceName(deviceName, platform);
  const pollSecret = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  // Drop stale unapproved requests first so their codes free up.
  await pool.query('DELETE FROM watch_pairings WHERE approved_at IS NULL AND expires_at < now()');

  // A collision on the pending-code index is vanishingly rare; retry a few times.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO watch_pairings (device_name, platform, code_hash, poll_secret_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, platform, sha256(code), sha256(pollSecret), expiresAt]
      );
      return { pairingId: rows[0].id, code, pollSecret, expiresInSeconds: CODE_TTL_MS / 1000 };
    } catch (err) {
      if (err.code !== '23505') throw err;
    }
  }
  throw httpError('Could not create a pairing code. Try again.', 503);
}

// Phone side: the signed-in account approves the watch showing this code.
async function confirmPairing(userId, code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw httpError('Enter the 6-digit code shown on your watch.', 400);

  const { rows: active } = await pool.query(
    'SELECT count(*)::int AS n FROM watch_pairings WHERE user_id = $1 AND approved_at IS NOT NULL AND revoked_at IS NULL',
    [userId]
  );
  if (active[0].n >= MAX_ACTIVE_WATCHES) {
    throw httpError(`You can connect up to ${MAX_ACTIVE_WATCHES} watches. Remove one first.`, 409);
  }

  const { rows } = await pool.query(
    `UPDATE watch_pairings SET user_id = $1, approved_at = now()
     WHERE code_hash = $2 AND approved_at IS NULL AND expires_at > now()
     RETURNING id, device_name, platform`,
    [userId, sha256(code)]
  );
  if (!rows[0]) throw httpError('That code is wrong or has expired. Check your watch for a new one.', 404);
  return { id: rows[0].id, deviceName: rows[0].device_name, platform: rows[0].platform };
}

// Watch side. Hands the token over once; afterwards the pairing reads as done.
async function pollPairing({ pairingId, pollSecret }) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(pairingId || '')) || !pollSecret) throw httpError('pairingId and pollSecret are required.', 400);

  const { rows } = await pool.query(
    `SELECT * FROM watch_pairings WHERE id = $1 AND poll_secret_hash = $2`,
    [pairingId, sha256(pollSecret)]
  );
  const row = rows[0];
  if (!row || row.revoked_at) throw httpError('Pairing not found.', 404);

  if (!row.approved_at) {
    if (new Date(row.expires_at) < new Date()) return { status: 'expired' };
    return { status: 'pending' };
  }
  if (row.token_issued_at) return { status: 'already_collected' };

  const claimed = await pool.query(
    'UPDATE watch_pairings SET token_issued_at = now() WHERE id = $1 AND token_issued_at IS NULL RETURNING user_id',
    [row.id]
  );
  if (!claimed.rows[0]) return { status: 'already_collected' };

  const user = await authService.findUserById(claimed.rows[0].user_id);
  if (!user) throw httpError('Pairing not found.', 404);
  return { status: 'approved', token: authService.signWatchSession(user, row.id), displayName: user.display_name || null };
}

async function listDevices(userId) {
  const { rows } = await pool.query(
    `SELECT id, device_name, platform, approved_at, last_used_at
     FROM watch_pairings WHERE user_id = $1 AND approved_at IS NOT NULL AND revoked_at IS NULL
     ORDER BY approved_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.device_name,
    platform: r.platform,
    pairedAt: r.approved_at,
    lastUsedAt: r.last_used_at,
  }));
}

async function revokeDevice(userId, id) {
  const { rowCount } = await pool.query(
    'UPDATE watch_pairings SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [id, userId]
  );
  return rowCount > 0;
}

// Called by the auth middleware for every watch-token request: the token is
// only good while its pairing row exists, is approved and is not revoked.
async function checkWatchSession(watchId, userId) {
  const { rows } = await pool.query(
    `UPDATE watch_pairings
        SET last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < now() - interval '1 minute' THEN now() ELSE last_used_at END
      WHERE id = $1 AND user_id = $2 AND approved_at IS NOT NULL AND revoked_at IS NULL
      RETURNING id`,
    [watchId, userId]
  );
  return rows.length > 0;
}

module.exports = { startPairing, confirmPairing, pollPairing, listDevices, revokeDevice, checkWatchSession };
