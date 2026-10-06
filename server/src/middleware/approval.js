const config = require('../config');

// Admin accounts (config.adminEmails) are always approved - otherwise the
// first sign-in of the only admin would lock everyone, admin included, out.
function isAdminUser(user) {
  const email = (user?.email || '').toLowerCase();
  return Boolean(email) && config.adminEmails.includes(email);
}

function effectiveApprovalStatus(user) {
  if (isAdminUser(user)) return 'approved';
  return user?.approval_status || 'approved';
}

// What a pending account may GET: the dashboard screen and the read-only data
// behind it. Deliberately an allow-list, not a deny-list - anything not named
// here (chat, uploads, AI recipes/explanations, Gmail import, usage, files...)
// stays closed, including routes added later.
const PENDING_READ_ALLOWED = [
  /^\/api\/auth\/me$/,
  /^\/api\/dashboard(\/|$)/,
  /^\/api\/activity\/summary$/,
  /^\/api\/diet\/summary$/,
  /^\/api\/insurance\/summary$/,
  /^\/api\/water\/(summary|target)$/,
  /^\/api\/devices(\/|$)/,
  /^\/api\/retest(\/|$)/,
  /^\/api\/pinned-parameters$/,
  /^\/api\/health-profile(\/|$)/,
  /^\/api\/weight-goal$/,
  /^\/api\/consents$/,
  /^\/api\/family(\/|$)/,
];

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Returns null when the request may proceed, else the { status, body } to
// answer with. `code` lets the client tell "waiting for approval" from an
// ordinary 403.
function approvalBlock(user, req) {
  const status = effectiveApprovalStatus(user);
  if (status === 'approved') return null;
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');

  if (status === 'rejected') {
    if (req.method === 'GET' && path === '/api/auth/me') return null;
    return {
      status: 403,
      body: { code: 'account_rejected', error: 'Your access request was not approved.' },
    };
  }

  if (READ_ONLY_METHODS.has(req.method) && PENDING_READ_ALLOWED.some((re) => re.test(path))) return null;
  return {
    status: 403,
    body: {
      code: 'account_pending',
      error: 'Your account is waiting for admin approval. You can look around, but uploads, AI features and changes are turned off until then.',
    },
  };
}

module.exports = { approvalBlock, effectiveApprovalStatus, isAdminUser };
