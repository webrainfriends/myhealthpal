const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(config.googleClientId);
  return client;
}

// Verifies a Google Identity Services ID token (issued client-side for our
// own OAuth client) - checks signature, issuer, audience, and expiry
// against Google's own public keys, fetched/cached by the library itself.
// Throws on any failure; never returns a partial/unverified result.
async function verifyGoogleIdToken(idToken) {
  if (!config.googleClientId) {
    throw new Error('Google sign-in is not configured on this server.');
  }
  const ticket = await getClient().verifyIdToken({ idToken, audience: config.googleClientId });
  const payload = ticket.getPayload();
  return {
    providerUserId: payload.sub,
    email: payload.email_verified ? payload.email : null,
    displayName: payload.name || null,
  };
}

module.exports = { verifyGoogleIdToken };
