const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { isAdminUser } = require('../middleware/approval');

// Long-lived on purpose - there is no refresh-token flow yet, so a short
// expiry would just log people out with no way back in short of signing in
// again. Revoking a specific session before then isn't supported either;
// rotating JWT_SECRET is the only way to invalidate every session at once.
const SESSION_TTL = '180d';

// `sid` identifies this one sign-in, so AI token usage (aiUsageService.js)
// can be broken down per session rather than only per user.
function signSession(user) {
  return jwt.sign({ sub: user.id, sid: crypto.randomUUID() }, config.jwtSecret, { expiresIn: SESSION_TTL });
}

// Throws (jsonwebtoken's own error) on a missing/expired/tampered token -
// callers (the auth middleware) turn that into a 401, never a silent
// fallback to some default identity.
// A watch gets its own token: same signing key, but `scope: 'watch'` plus the
// id of its watch_pairings row. The auth middleware limits it to an allow-list
// of routes and checks that row on every request, so it can be revoked.
const WATCH_TTL = '90d';

function signWatchSession(user, watchId) {
  return jwt.sign({ sub: user.id, sid: `watch-${watchId}`, scope: 'watch', wid: watchId }, config.jwtSecret, {
    expiresIn: WATCH_TTL,
  });
}

function verifySessionUserId(token) {
  return verifySession(token).userId;
}

// Same contract as verifySessionUserId, plus the session id. Tokens issued
// before `sid` existed fall back to their issue time, which is still unique
// per sign-in for a given user.
function verifySession(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  return {
    userId: payload.sub,
    sessionId: payload.sid || `iat-${payload.iat}`,
    scope: payload.scope || null,
    watchId: payload.wid || null,
  };
}

// A file-open link (window.open/Linking.openURL, or a plain <a href>) can't
// carry an Authorization header, so viewing an original report file uses a
// second, narrowly-scoped token instead of the session one:
//  - signed with its own key, derived from JWT_SECRET via HKDF, so a
//    session token can never verify as a download token (or vice versa);
//  - tied to one report and one user, with a unique jti (optionally
//    single-use - see routes/files.js);
//  - short-lived (DOWNLOAD_TOKEN_TTL_SECONDS, default 5 minutes).
function downloadTokenKey() {
  return Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:report-download:v1', 32));
}

function signReportDownloadToken({ userId, reportId }) {
  return jwt.sign({ sub: userId, reportId, type: 'report_download' }, downloadTokenKey(), {
    expiresIn: config.security.downloadTokenTtlSeconds,
    jwtid: crypto.randomUUID(),
    algorithm: 'HS256',
  });
}

// Throws on a missing/expired/tampered token, or one that isn't actually a
// download token - same "never silently fall back" contract as
// verifySessionUserId.
function verifyReportDownloadToken(token) {
  const payload = jwt.verify(token, downloadTokenKey(), { algorithms: ['HS256'] });
  if (payload.type !== 'report_download' || !payload.jti) {
    throw new Error('Not a report download token');
  }
  return { userId: payload.sub, reportId: payload.reportId, jti: payload.jti, expiresAt: payload.exp };
}

// Same shape and reasoning as signReportDownloadToken/verifyReportDownloadToken
// above, scoped to a medication photo instead of a report - its own HKDF
// info string keeps the two token families from ever verifying as each other.
function medicationPhotoDownloadTokenKey() {
  return Buffer.from(
    crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:medication-photo-download:v1', 32)
  );
}

function signMedicationPhotoDownloadToken({ userId, photoId }) {
  return jwt.sign({ sub: userId, photoId, type: 'medication_photo_download' }, medicationPhotoDownloadTokenKey(), {
    expiresIn: config.security.downloadTokenTtlSeconds,
    jwtid: crypto.randomUUID(),
    algorithm: 'HS256',
  });
}

function verifyMedicationPhotoDownloadToken(token) {
  const payload = jwt.verify(token, medicationPhotoDownloadTokenKey(), { algorithms: ['HS256'] });
  if (payload.type !== 'medication_photo_download' || !payload.jti) {
    throw new Error('Not a medication photo download token');
  }
  return { userId: payload.sub, photoId: payload.photoId, jti: payload.jti, expiresAt: payload.exp };
}

// Short-lived, video-scoped playback token (issue #135 Phase 3). Unlike the
// report/photo tokens it is NOT single-use: a video player issues several
// range requests for one playback. It stays bound to one user + one asset
// and expires quickly, and its own HKDF label keeps it from verifying as any
// other token family.
function workoutVideoTokenKey() {
  return Buffer.from(
    crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:workout-video:v1', 32)
  );
}

function signWorkoutVideoToken({ userId, assetId }) {
  return jwt.sign({ sub: userId, assetId, type: 'workout_video' }, workoutVideoTokenKey(), {
    expiresIn: config.security.workoutVideoTokenTtlSeconds,
    jwtid: crypto.randomUUID(),
    algorithm: 'HS256',
  });
}

function verifyWorkoutVideoToken(token) {
  const payload = jwt.verify(token, workoutVideoTokenKey(), { algorithms: ['HS256'] });
  if (payload.type !== 'workout_video') throw new Error('Not a workout video token');
  return { userId: payload.sub, assetId: payload.assetId, expiresAt: payload.exp };
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// Thrown by anything that would add a new row to `users` once the closed-beta
// cap (config.maxRegisteredUsers) is already reached. Never thrown for a
// login of an already-existing user - only for registration.
class RegistrationClosedError extends Error {
  constructor() {
    super('Registration is currently closed - this app has reached its user limit.');
    this.code = 'registration_closed';
  }
}

// Arbitrary but stable lock key, scoped to this one purpose so it can never
// collide with an advisory lock taken elsewhere for something else.
const REGISTRATION_CAP_LOCK_KEY = 0x6d68706c;

// Serializes "count existing users, then insert one more" against every
// other caller of this function via a transaction-scoped advisory lock, so
// two concurrent sign-ups right at the cap can never both read the same
// pre-insert count and both squeeze through. `insertFn` receives the locked
// transaction's client and must do exactly one INSERT INTO users with it.
async function withRegistrationCap(insertFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [REGISTRATION_CAP_LOCK_KEY]);
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM users');
    if (rows[0].count >= config.maxRegisteredUsers) {
      await client.query('ROLLBACK');
      throw new RegistrationClosedError();
    }
    const user = await insertFn(client);
    await client.query('COMMIT');
    return user;
  } catch (err) {
    if (!(err instanceof RegistrationClosedError)) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
}

// Used by GET /auth/config to tell the client whether registration is still
// open, without duplicating the count query.
async function countUsers() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  return rows[0].count;
}

async function createGuestUser() {
  return withRegistrationCap((client) =>
    client
      .query(`INSERT INTO users (auth_provider, display_name, last_login_at, approval_status)
         VALUES ('guest', 'Guest', now(), 'pending') RETURNING *`)
      .then((r) => r.rows[0])
  );
}

// Looks up an existing account for this provider identity, or creates one.
// Never matched by email - two providers can plausibly report the same
// address for the same person, and provider_user_id is the actual stable
// identity Google/Apple vouch for.
async function upsertOAuthUser({ provider, providerUserId, email, displayName }) {
  const existing = await pool.query('SELECT * FROM users WHERE auth_provider = $1 AND provider_user_id = $2', [
    provider,
    providerUserId,
  ]);
  if (existing.rows.length > 0) {
    const { rows } = await pool.query(
      `UPDATE users SET email = COALESCE($2, email), display_name = COALESCE($3, display_name), last_login_at = now(),
         approval_status = CASE WHEN $4 THEN 'approved' ELSE approval_status END
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, email || null, displayName || null, isAdminUser({ email: email || existing.rows[0].email })]
    );
    return rows[0];
  }
  // Only reachable for a provider identity never seen before - this is a new
  // registration, so it's the one branch of this function the cap applies to.
  return withRegistrationCap((client) =>
    client
      .query(
        `INSERT INTO users (auth_provider, provider_user_id, email, display_name, last_login_at, approval_status)
         VALUES ($1, $2, $3, $4, now(), $5) RETURNING *`,
        [
          provider,
          providerUserId,
          email || null,
          displayName || null,
          // Admins never wait on themselves; everyone else waits for one.
          isAdminUser({ email }) ? 'approved' : 'pending',
        ]
      )
      .then((r) => r.rows[0])
  );
}

// Google's OAuth redirect (routes/integrations/gmail.js's /callback) carries
// no Authorization header of its own - the browser, not our app, follows it
// - so the signed-in user it belongs to has to travel round-trip inside the
// OAuth `state` parameter instead. Short-lived and its own `type` for the
// same reason signReportDownloadToken has one: a leaked/replayed session or
// download token must never be accepted here as a connect request for
// someone else's account.
const GMAIL_OAUTH_STATE_TTL = '10m';

function signGmailOAuthState(userId) {
  return jwt.sign({ sub: userId, type: 'gmail_oauth_state' }, config.jwtSecret, { expiresIn: GMAIL_OAUTH_STATE_TTL });
}

function verifyGmailOAuthState(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.type !== 'gmail_oauth_state') {
    throw new Error('Not a Gmail OAuth state token');
  }
  return payload.sub;
}

module.exports = {
  signWatchSession,
  signSession,
  verifySessionUserId,
  verifySession,
  signReportDownloadToken,
  verifyReportDownloadToken,
  signMedicationPhotoDownloadToken,
  verifyMedicationPhotoDownloadToken,
  signWorkoutVideoToken,
  verifyWorkoutVideoToken,
  signGmailOAuthState,
  verifyGmailOAuthState,
  findUserById,
  createGuestUser,
  upsertOAuthUser,
  countUsers,
  RegistrationClosedError,
  REGISTRATION_CAP_LOCK_KEY,
};
