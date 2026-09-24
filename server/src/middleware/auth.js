const authService = require('../services/authService');
const { runWithContext } = require('../lib/requestContext');

// Attaches req.user from a verified "Authorization: Bearer <token>" -
// the only source of identity for any user-scoped route from here on.
// A client-supplied user id (the old x-user-id header) is never trusted:
// that let any caller read/write any other user's data just by setting
// a header, which is exactly the isolation guarantee this replaces.
async function requireAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  let userId;
  let sessionId;
  try {
    ({ userId, sessionId } = authService.verifySession(token));
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  try {
    const user = await authService.findUserById(userId);
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    }
    req.user = user;
    req.sessionId = sessionId;
    // Everything downstream of this request - including background work it
    // kicks off - is attributed to this user and session for AI usage
    // tracking (see services/aiUsageService.js).
    runWithContext({ userId: user.id, sessionId }, () => next());
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
