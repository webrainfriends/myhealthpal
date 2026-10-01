const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const audit = require('../security/auditLog');
const { normalizeScopes } = require('./scopes');

const CODE_TTL_SECONDS = 600;
const TICKET_TTL_SECONDS = 600;

class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description || error);
    this.oauthError = error;
    this.status = status;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---------------------------------------------------------------- clients

function isAllowedRedirect(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const allow = config.mcp.redirectHostAllowlist;
  if (allow.length > 0 && !loopback && !allow.includes(url.hostname.toLowerCase())) return false;
  return true;
}

// RFC 7591 dynamic client registration - public clients only (PKCE, no secret).
async function registerClient({ clientName, redirectUris }) {
  const uris = Array.isArray(redirectUris) ? redirectUris : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === 'string' && isAllowedRedirect(u))) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1-10 https (or loopback http) URLs.');
  }
  const name = typeof clientName === 'string' && clientName.trim() ? clientName.trim().slice(0, 80) : 'AI assistant';
  const clientId = `emh_${randomToken(18)}`;
  await pool.query('INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)', [
    clientId,
    name,
    uris,
  ]);
  return { client_id: clientId, client_name: name, redirect_uris: uris };
}

async function getClient(clientId) {
  if (typeof clientId !== 'string') return null;
  const { rows } = await pool.query('SELECT * FROM oauth_clients WHERE client_id = $1', [clientId]);
  return rows[0] || null;
}

// Validates the parts of an authorization request that must never be echoed
// back to an unregistered redirect (client + redirect_uri), then the rest.
async function validateAuthorizationRequest(params) {
  const client = await getClient(params.client_id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id.');
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    throw new OAuthError('invalid_request', 'redirect_uri does not match a registered URI.');
  }
  if (params.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported.');
  if (!params.code_challenge || params.code_challenge_method !== 'S256') {
    throw new OAuthError('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) {
    throw new OAuthError('invalid_request', 'code_challenge must be a base64url SHA-256 digest.');
  }
  const scopes = normalizeScopes(params.scope);
  return { client, scopes };
}

// ------------------------------------------------- sign-in ticket (browser)

// Proves "this browser just signed in as user X" between the sign-in and the
// approve step of the consent page, bound to the exact authorization request
// so it can't be replayed against different parameters. Own HKDF key, own
// `type` - a session token can never verify as one.
function ticketKey() {
  return Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:oauth-ticket:v1', 32));
}

function requestFingerprint(p) {
  return sha256([p.client_id, p.redirect_uri, p.code_challenge, p.state || '', p.scope || ''].join('\n'));
}

function signTicket(userId, params) {
  return jwt.sign({ sub: userId, type: 'oauth_ticket', rf: requestFingerprint(params) }, ticketKey(), {
    algorithm: 'HS256',
    expiresIn: TICKET_TTL_SECONDS,
  });
}

function verifyTicket(ticket, params) {
  let payload;
  try {
    payload = jwt.verify(ticket, ticketKey(), { algorithms: ['HS256'] });
  } catch {
    throw new OAuthError('access_denied', 'Sign-in expired. Please start again.', 401);
  }
  if (payload.type !== 'oauth_ticket' || payload.rf !== requestFingerprint(params)) {
    throw new OAuthError('access_denied', 'Sign-in does not match this request.', 401);
  }
  return payload.sub;
}

// ------------------------------------------------------------- authorize

// Creates the grant and a single-use code once the user approved on the
// consent page. `scopes` is what the user ticked, never more than requested.
async function approveAuthorization({ userId, params, approvedScopes }) {
  const { client, scopes: requested } = await validateAuthorizationRequest(params);
  const scopes = normalizeScopes(approvedScopes).filter((s) => requested.includes(s) || requested.length === 0);
  if (scopes.length === 0) throw new OAuthError('access_denied', 'No access was granted.');

  // One live grant per user+client: re-authorising replaces the old one.
  await pool.query(
    'UPDATE oauth_grants SET revoked_at = now() WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL',
    [userId, client.client_id]
  );
  const { rows } = await pool.query(
    'INSERT INTO oauth_grants (client_id, user_id, scopes) VALUES ($1, $2, $3) RETURNING id',
    [client.client_id, userId, scopes]
  );
  const grantId = rows[0].id;
  const code = randomToken();
  await pool.query(
    `INSERT INTO oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [sha256(code), grantId, params.redirect_uri, params.code_challenge, String(CODE_TTL_SECONDS)]
  );
  await audit.record({ eventType: 'MCP_GRANT_CREATED', userId, actorUserId: userId, purpose: scopes.join(' ') });
  return { code, grantId };
}

// ----------------------------------------------------------------- tokens

async function issueTokens(grantId, scopes) {
  const access = randomToken();
  const refresh = randomToken();
  const { accessTokenTtlSeconds, refreshTokenTtlDays } = config.mcp;
  await pool.query(
    `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES
       ($1, $3, 'access', now() + ($4 || ' seconds')::interval),
       ($2, $3, 'refresh', now() + ($5 || ' days')::interval)`,
    [sha256(access), sha256(refresh), grantId, String(accessTokenTtlSeconds), String(refreshTokenTtlDays)]
  );
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: accessTokenTtlSeconds,
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

function pkceMatches(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function exchangeCode({ clientId, code, redirectUri, codeVerifier }) {
  if (!code) throw new OAuthError('invalid_request', 'code is required.');
  // Atomically consume the code so a replay can never mint a second token pair.
  const { rows } = await pool.query(
    `UPDATE oauth_codes SET used_at = now()
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING grant_id, redirect_uri, code_challenge`,
    [sha256(code)]
  );
  if (rows.length === 0) {
    // A code presented twice is a theft signal: kill whatever it produced.
    const reused = await pool.query('SELECT grant_id FROM oauth_codes WHERE code_hash = $1 AND used_at IS NOT NULL', [
      sha256(code),
    ]);
    if (reused.rows[0]) await pool.query('UPDATE oauth_grants SET revoked_at = now() WHERE id = $1', [reused.rows[0].grant_id]);
    throw new OAuthError('invalid_grant', 'Authorization code is invalid, expired or already used.');
  }
  const row = rows[0];
  const grant = (await pool.query('SELECT * FROM oauth_grants WHERE id = $1 AND revoked_at IS NULL', [row.grant_id])).rows[0];
  if (!grant || grant.client_id !== clientId || row.redirect_uri !== redirectUri || !pkceMatches(codeVerifier, row.code_challenge)) {
    throw new OAuthError('invalid_grant', 'Authorization code does not match this request.');
  }
  return issueTokens(grant.id, grant.scopes);
}

async function refreshTokens({ clientId, refreshToken }) {
  if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required.');
  const hash = sha256(refreshToken);
  const found = await pool.query(
    `SELECT t.*, g.client_id, g.scopes, g.revoked_at AS grant_revoked_at
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.token_hash = $1 AND t.kind = 'refresh'`,
    [hash]
  );
  const token = found.rows[0];
  if (!token || token.client_id !== clientId || token.grant_revoked_at || token.revoked_at || token.expires_at < new Date()) {
    throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired.');
  }
  const consumed = await pool.query(
    'UPDATE oauth_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING 1',
    [hash]
  );
  if (consumed.rows.length === 0) {
    // Rotated token replayed: assume it leaked and end the whole grant.
    await revokeGrantById(token.grant_id);
    throw new OAuthError('invalid_grant', 'Refresh token was already used; access has been revoked. Please reconnect.');
  }
  return issueTokens(token.grant_id, token.scopes);
}

// Resolves a presented access token to its grant. Returns null for anything
// unknown, expired, revoked, or not an access token.
async function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const { rows } = await pool.query(
    `SELECT g.id AS grant_id, g.user_id, g.scopes, g.client_id
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.token_hash = $1 AND t.kind = 'access'
       AND t.revoked_at IS NULL AND t.expires_at > now() AND g.revoked_at IS NULL`,
    [sha256(token)]
  );
  if (rows.length === 0) return null;
  pool.query('UPDATE oauth_grants SET last_used_at = now() WHERE id = $1', [rows[0].grant_id]).catch(() => {});
  return { grantId: rows[0].grant_id, userId: rows[0].user_id, scopes: rows[0].scopes, clientId: rows[0].client_id };
}

// ------------------------------------------------------------- revocation

async function revokeGrantById(grantId) {
  const { rows } = await pool.query(
    'UPDATE oauth_grants SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING user_id',
    [grantId]
  );
  await pool.query('UPDATE oauth_tokens SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL', [grantId]);
  if (rows[0]) await audit.record({ eventType: 'MCP_GRANT_REVOKED', userId: rows[0].user_id, actorUserId: rows[0].user_id });
}

// RFC 7009: always succeeds from the caller's point of view.
async function revokeToken({ clientId, token }) {
  if (typeof token !== 'string') return;
  const { rows } = await pool.query(
    `SELECT t.grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = $1`,
    [sha256(token)]
  );
  if (rows[0] && rows[0].client_id === clientId) await revokeGrantById(rows[0].grant_id);
}

async function listGrants(userId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.scopes, g.created_at, g.last_used_at, c.client_name
     FROM oauth_grants g JOIN oauth_clients c ON c.client_id = g.client_id
     WHERE g.user_id = $1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC`,
    [userId]
  );
  return rows;
}

async function revokeUserGrant(userId, grantId) {
  const { rows } = await pool.query('SELECT 1 FROM oauth_grants WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [
    grantId,
    userId,
  ]);
  if (rows.length === 0) return false;
  await revokeGrantById(grantId);
  return true;
}

module.exports = {
  OAuthError,
  registerClient,
  getClient,
  validateAuthorizationRequest,
  signTicket,
  verifyTicket,
  approveAuthorization,
  exchangeCode,
  refreshTokens,
  verifyAccessToken,
  revokeToken,
  listGrants,
  revokeUserGrant,
  isAllowedRedirect,
};
