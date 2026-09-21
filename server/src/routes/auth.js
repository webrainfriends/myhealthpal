const express = require('express');
const config = require('../config');
const authService = require('../services/authService');
const { verifyGoogleIdToken } = require('../services/googleAuthService');
const { verifyAppleIdentityToken } = require('../services/appleAuthService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    authProvider: user.auth_provider,
  };
}

// Public: tells the client which sign-in options to actually offer. Client
// IDs are not secrets (they're embedded in every client-side auth request
// regardless of who can see this endpoint), so exposing them unauthenticated
// is safe - this is only ever config, never a credential.
router.get('/config', (req, res) => {
  res.json({
    googleClientId: config.googleClientId,
    appleClientId: config.appleClientId,
  });
});

router.post('/guest', async (req, res, next) => {
  try {
    const user = await authService.createGuestUser();
    res.status(201).json({ token: authService.signSession(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/google', async (req, res) => {
  if (!req.body.idToken) return res.status(400).json({ error: 'idToken is required.' });
  try {
    const { providerUserId, email, displayName } = await verifyGoogleIdToken(req.body.idToken);
    const user = await authService.upsertOAuthUser({ provider: 'google', providerUserId, email, displayName });
    res.json({ token: authService.signSession(user), user: publicUser(user) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Google sign-in failed:', err.message);
    if (err.message.includes('not configured')) return res.status(503).json({ error: err.message });
    res.status(401).json({ error: 'Could not verify Google sign-in.' });
  }
});

router.post('/apple', async (req, res) => {
  if (!req.body.identityToken) return res.status(400).json({ error: 'identityToken is required.' });
  try {
    const { providerUserId, email } = await verifyAppleIdentityToken(req.body.identityToken);
    // Apple sends the display name only once, client-side, on first
    // authorization - never inside the token itself - so accept it from
    // the request body that one time, exactly as the client received it.
    const displayName = req.body.fullName || null;
    const user = await authService.upsertOAuthUser({ provider: 'apple', providerUserId, email, displayName });
    res.json({ token: authService.signSession(user), user: publicUser(user) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Apple sign-in failed:', err.message);
    if (err.message.includes('not configured')) return res.status(503).json({ error: err.message });
    res.status(401).json({ error: 'Could not verify Apple sign-in.' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
