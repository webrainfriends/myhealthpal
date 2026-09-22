const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');

// Long-lived on purpose - there is no refresh-token flow yet, so a short
// expiry would just log people out with no way back in short of signing in
// again. Revoking a specific session before then isn't supported either;
// rotating JWT_SECRET is the only way to invalidate every session at once.
const SESSION_TTL = '180d';

function signSession(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: SESSION_TTL });
}

// Throws (jsonwebtoken's own error) on a missing/expired/tampered token -
// callers (the auth middleware) turn that into a 401, never a silent
// fallback to some default identity.
function verifySessionUserId(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  return payload.sub;
}

// A file-open link (window.open/Linking.openURL, or a plain <a href>) can't
// carry an Authorization header, so viewing an original report file uses a
// second, narrowly-scoped token instead of the session one: short-lived,
// tied to one specific report, and tagged with its own `type` so a leaked
// download link can never be replayed as a session token (or vice versa).
const DOWNLOAD_TOKEN_TTL = '10m';

function signReportDownloadToken({ userId, reportId }) {
  return jwt.sign({ sub: userId, reportId, type: 'report_download' }, config.jwtSecret, {
    expiresIn: DOWNLOAD_TOKEN_TTL,
  });
}

// Throws on a missing/expired/tampered token, or one that isn't actually a
// download token (e.g. a session token reused here) - same "never silently
// fall back" contract as verifySessionUserId.
function verifyReportDownloadToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.type !== 'report_download') {
    throw new Error('Not a report download token');
  }
  return { userId: payload.sub, reportId: payload.reportId };
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createGuestUser() {
  const { rows } = await pool.query(
    `INSERT INTO users (auth_provider, display_name, last_login_at) VALUES ('guest', 'Guest', now()) RETURNING *`
  );
  return rows[0];
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
      `UPDATE users SET email = COALESCE($2, email), display_name = COALESCE($3, display_name), last_login_at = now()
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, email || null, displayName || null]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO users (auth_provider, provider_user_id, email, display_name, last_login_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING *`,
    [provider, providerUserId, email || null, displayName || null]
  );
  return rows[0];
}

module.exports = {
  signSession,
  verifySessionUserId,
  signReportDownloadToken,
  verifyReportDownloadToken,
  findUserById,
  createGuestUser,
  upsertOAuthUser,
};
