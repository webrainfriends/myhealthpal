const express = require('express');
const pool = require('../db/pool');
const authService = require('../services/authService');
const { deleteAccount } = require('../services/accountDeletionService');

// Mounted behind requireAccountAuth + requireAdmin (app.js) - every route
// here is only ever reachable by config.adminEmails.
const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicSession(row, req) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    authProvider: row.auth_provider,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    isSelf: row.id === req.accountUser.id,
  };
}

// Every `users` row that can itself sign in - registered (google/apple) and
// guest. 'managed' family profiles (see migrations/021_family_profiles.sql)
// have no sign-in of their own, so they're not a "session" or "login" and
// are left off this list; deleting their sole manager below still sweeps
// them up too, same as a self-service account deletion would.
router.get('/sessions', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, auth_provider, created_at, last_login_at
       FROM users
       WHERE auth_provider IN ('guest', 'google', 'apple')
       ORDER BY COALESCE(last_login_at, created_at) DESC`
    );
    res.json({ sessions: rows.map((row) => publicSession(row, req)) });
  } catch (err) {
    next(err);
  }
});

// Deletes one registered/guest login and everything that belongs to it -
// the exact same routine (accountDeletionService.deleteAccount) that
// DELETE /api/account runs when a user deletes their own account. There is
// no recovery.
router.delete('/sessions/:userId', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid session id.' });
    }
    if (req.params.userId === req.accountUser.id) {
      return res.status(400).json({ error: 'Use Settings > Delete account to delete your own account.' });
    }
    const target = await authService.findUserById(req.params.userId);
    if (!target || target.auth_provider === 'managed') {
      return res.status(404).json({ error: 'Session not found.' });
    }
    await deleteAccount(target.id, { purpose: 'admin_cleanup' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Bulk "cleanup": every guest login in one sweep. Guest sessions accumulate
// fastest - each guest sign-in creates a brand-new `users` row that's never
// reused - so this is the one case worth a bulk action rather than deleting
// one at a time.
router.delete('/sessions/cleanup/guests', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id FROM users WHERE auth_provider = 'guest'`);
    for (const row of rows) {
      await deleteAccount(row.id, { purpose: 'admin_cleanup' });
    }
    res.json({ deletedCount: rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
