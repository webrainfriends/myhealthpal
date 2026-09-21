const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const config = require('../config');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';

const jwks = jwksClient({ jwksUri: APPLE_JWKS_URI, cache: true, cacheMaxAge: 24 * 60 * 60 * 1000 });

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// Verifies an identityToken from Apple's JS SDK (AppleID.auth.signIn) -
// checks signature (against Apple's public keys), issuer, audience (our
// Services ID), and expiry. No Apple private key/client secret involved:
// that's only needed to mint or refresh Apple's own tokens server-side,
// which this app never does - only verifying a token Apple already issued.
function verifyAppleIdentityToken(identityToken) {
  if (!config.appleClientId) {
    return Promise.reject(new Error('Sign in with Apple is not configured on this server.'));
  }
  return new Promise((resolve, reject) => {
    jwt.verify(
      identityToken,
      getSigningKey,
      { algorithms: ['RS256'], issuer: APPLE_ISSUER, audience: config.appleClientId },
      (err, payload) => {
        if (err) return reject(err);
        resolve({
          providerUserId: payload.sub,
          // Apple only asserts the email on the token when it has verified
          // it; email_verified arrives as the string "true"/"false" in
          // practice, not a boolean, so compare it as a string.
          email: payload.email && String(payload.email_verified) !== 'false' ? payload.email : null,
        });
      }
    );
  });
}

module.exports = { verifyAppleIdentityToken };
