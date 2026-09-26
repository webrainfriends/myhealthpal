const crypto = require('crypto');
const authService = require('../services/authService');
const { runWithContext } = require('../lib/requestContext');
const familyService = require('../services/familyService');

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Attaches req.user from a verified "Authorization: Bearer <token>" -
// the only source of identity for any user-scoped route from here on.
// A client-supplied user id (the old x-user-id header) is never trusted:
// that let any caller read/write any other user's data just by setting
// a header, which is exactly the isolation guarantee this replaces.
function authenticate({ allowProfile }) {
  return async function authMiddleware(req, res, next) {
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
      // The signed-in account itself - family management, push tokens and
      // reminder settings always belong to it, whichever profile is active.
      req.accountUser = user;
      req.user = user;
      req.sessionId = sessionId;

      // Acting as a family member's profile (see migrations/021): only ever
      // honored when a family_links row grants this account access to it,
      // so the header can never reach an arbitrary user's data. A 'view'
      // link is read-only.
      const profileId = req.header('x-profile-id');
      if (allowProfile && profileId && profileId !== user.id) {
        const link = UUID_RE.test(profileId) ? await familyService.findLink(user.id, profileId) : null;
        if (!link) return res.status(403).json({ error: 'You do not have access to this profile.' });
        if (link.access === 'view' && !READ_ONLY_METHODS.has(req.method)) {
          return res.status(403).json({ error: 'You have view-only access to this profile.' });
        }
        const member = await authService.findUserById(profileId);
        if (!member) return res.status(403).json({ error: 'You do not have access to this profile.' });
        req.user = member;
        req.profileAccess = link.access;
      }

      // Everything downstream of this request - including background work
      // it kicks off - is attributed to the signed-in account and session
      // for AI usage tracking (see services/aiUsageService.js), even while
      // acting as a family member's profile.
      runWithContext(
        {
          userId: user.id,
          sessionId,
          // Request metadata for security audit events - kept in memory for
          // the request only; auditLog stores just a keyed hash of the IP
          // and a coarse client category.
          requestId: crypto.randomUUID(),
          clientIp: req.ip,
          userAgent: req.get('user-agent'),
        },
        () => next()
      );
    } catch (err) {
      next(err);
    }
  };
}

// Data routes: honor X-Profile-Id (act as a linked family member).
const requireAuth = authenticate({ allowProfile: true });
// Account routes (sign-in profile, family management, push tokens,
// reminder settings): always the signed-in account, whatever profile the
// client currently has selected.
const requireAccountAuth = authenticate({ allowProfile: false });

module.exports = { requireAuth, requireAccountAuth };
