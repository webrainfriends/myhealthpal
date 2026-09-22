const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function assertConfigured() {
  if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRedirectUri) {
    throw new Error('Gmail integration is not configured on this server.');
  }
}

function getOAuthClient() {
  assertConfigured();
  return new OAuth2Client(config.gmailClientId, config.gmailClientSecret, config.gmailRedirectUri);
}

// `state` is an opaque, server-signed token (authService.signGmailOAuthState)
// - Google only ever echoes it back verbatim on the callback, never reads it.
function buildAuthUrl(state) {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    // Forces Google to always hand back a refresh_token, even if this user
    // authorized before - without it, a *second* consent for an already-
    // granted app returns an access token only, silently breaking
    // reconnect-after-revoke.
    prompt: 'consent',
    scope: config.gmailScopes,
    state,
  });
}

// Exchanges an authorization code for tokens, and identifies which Google
// account was actually granted (never assumed from the signed-in
// MyHealthPal user - a person can authorize a *different* Gmail address
// than the one they used to sign in to the app).
async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Disconnect any prior authorization for this app in your Google Account and try connecting again.'
    );
  }
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.gmailClientId });
  const payload = ticket.getPayload();
  return {
    refreshToken: tokens.refresh_token,
    providerAccountId: payload.sub,
    emailAddress: payload.email,
    scopes: (tokens.scope || config.gmailScopes.join(' ')).split(' ').filter(Boolean),
  };
}

// Returns a short-lived access token for one API call. Never persisted by
// the caller - callers ask again next time rather than caching it
// themselves, keeping exactly one place (here) that ever holds a live
// Gmail credential in memory.
async function getAccessToken(refreshToken) {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Google did not return an access token.');
    return token;
  } catch (err) {
    // google-auth-library surfaces a revoked/expired refresh token as an
    // invalid_grant error from Google's token endpoint - the one condition
    // that means "this connection needs to be reauthorized", never a
    // transient failure worth retrying.
    if (err.message && err.message.includes('invalid_grant')) {
      const reauthError = new Error('Gmail authorization has expired or was revoked. Please reconnect Gmail.');
      reauthError.code = 'GMAIL_REAUTH_REQUIRED';
      throw reauthError;
    }
    throw err;
  }
}

async function revokeToken(token) {
  if (!token) return;
  await getOAuthClient().revokeToken(token);
}

async function gmailApiFetch(accessToken, path, options = {}) {
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`Gmail API request failed (${response.status}): ${body.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// Returns only message ids/threadIds matching `query` - the cheapest
// possible call for discovering candidates before any per-message fetch.
async function listMessageIds(accessToken, query, { maxResults = 25, pageToken } = {}) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set('pageToken', pageToken);
  const data = await gmailApiFetch(accessToken, `/messages?${params.toString()}`);
  return { messages: data.messages || [], nextPageToken: data.nextPageToken || null };
}

function headerValue(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || null;
}

// Walks a message's MIME part tree collecting only attachment metadata
// (filename, mimeType, attachmentId, size) - inline body parts (text/plain,
// text/html) are skipped entirely, so their content, once read off this
// response, is never carried any further than this function's stack frame.
function collectAttachmentParts(parts, out = []) {
  if (!Array.isArray(parts)) return out;
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        sizeEstimate: part.body.size || 0,
      });
    }
    if (part.parts) collectAttachmentParts(part.parts, out);
  }
  return out;
}

// format=full is the only way for the Gmail API to report attachment parts
// at all ('metadata' format omits the part tree) - but only header values
// and attachment metadata are ever read off the result below; any inline
// text/HTML body Google includes in the same response is discarded here,
// never stored or passed to a caller.
async function getMessage(accessToken, messageId) {
  const data = await gmailApiFetch(accessToken, `/messages/${messageId}?format=full`);
  return {
    id: data.id,
    from: headerValue(data.payload?.headers, 'From'),
    subject: headerValue(data.payload?.headers, 'Subject'),
    receivedAt: data.internalDate ? new Date(Number(data.internalDate)) : null,
    attachments: collectAttachmentParts(data.payload?.parts),
  };
}

// Fetches one specific attachment's bytes (base64url) - never the whole
// message body, and never any attachment the caller didn't explicitly ask
// for by its own attachmentId.
async function getAttachmentData(accessToken, messageId, attachmentId) {
  const data = await gmailApiFetch(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  return Buffer.from(data.data, 'base64url');
}

module.exports = {
  assertConfigured,
  buildAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  revokeToken,
  listMessageIds,
  getMessage,
  getAttachmentData,
};
