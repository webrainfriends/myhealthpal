const express = require('express');
const pool = require('../db/pool');
const authService = require('../services/authService');
const { deleteAccount, FILE_TABLES } = require('../services/accountDeletionService');
const { getAllUsersUsageReport } = require('../services/aiUsageService');

// Mounted behind requireAccountAuth + requireAdmin (app.js) - every route
// here is only ever reachable by config.adminEmails.
const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Total bytes of every stored file (report/medication scan/diet scan) per
// user, from the same FILE_TABLES accountDeletionService unlinks from disk
// on deletion - so "doc storage" here always means exactly what deleting
// the login would free up.
async function getStorageBytesByUser() {
  const unionSql = FILE_TABLES.map((table) => `SELECT user_id, file_size_bytes FROM ${table}`).join(' UNION ALL ');
  const { rows } = await pool.query(
    `SELECT user_id, COALESCE(SUM(file_size_bytes), 0)::bigint AS bytes FROM (${unionSql}) f GROUP BY user_id`
  );
  return new Map(rows.map((row) => [row.user_id, Number(row.bytes)]));
}

function publicSession(row, req, { storageBytesByUser, aiUsageByUser }) {
  const usage = aiUsageByUser.get(row.id);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    authProvider: row.auth_provider,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    isSelf: row.id === req.accountUser.id,
    storageBytes: storageBytesByUser.get(row.id) || 0,
    aiUsage: {
      totalTokens: usage?.totalTokens || 0,
      requests: usage?.requests || 0,
      estimatedCostUsd: usage?.estimatedCostUsd || 0,
    },
  };
}

// Every `users` row that can itself sign in - registered (google/apple) and
// guest. 'managed' family profiles (see migrations/021_family_profiles.sql)
// have no sign-in of their own, so they're not a "session" or "login" and
// are left off this list; deleting their sole manager below still sweeps
// them up too, same as a self-service account deletion would. Each row
// also carries its all-time AI token usage/cost and its total stored file
// size, so the admin can see who's actually driving usage before deleting.
router.get('/sessions', async (req, res, next) => {
  try {
    const [{ rows }, storageBytesByUser, aiUsageRows] = await Promise.all([
      pool.query(
        `SELECT id, email, display_name, auth_provider, created_at, last_login_at
         FROM users
         WHERE auth_provider IN ('guest', 'google', 'apple')
         ORDER BY COALESCE(last_login_at, created_at) DESC`
      ),
      getStorageBytesByUser(),
      getAllUsersUsageReport({ days: null }),
    ]);
    const aiUsageByUser = new Map(aiUsageRows.filter((r) => r.userId).map((r) => [r.userId, r]));
    res.json({ sessions: rows.map((row) => publicSession(row, req, { storageBytesByUser, aiUsageByUser })) });
  } catch (err) {
    next(err);
  }
});

// Deletes one login (skipping a nonexistent/managed/self id, same rule the
// single- and multi-delete routes below both need) via the exact routine
// (accountDeletionService.deleteAccount) DELETE /api/account runs when a
// user deletes their own account. Returns whether it actually deleted
// something, so callers can tell a skip from a failure.
async function deleteOneSession(req, userId) {
  if (!UUID_RE.test(userId) || userId === req.accountUser.id) return false;
  const target = await authService.findUserById(userId);
  if (!target || target.auth_provider === 'managed') return false;
  await deleteAccount(target.id, { purpose: 'admin_cleanup' });
  return true;
}

// Deletes one registered/guest login and everything that belongs to it.
// There is no recovery.
router.delete('/sessions/:userId', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid session id.' });
    }
    if (req.params.userId === req.accountUser.id) {
      return res.status(400).json({ error: 'Use Settings > Delete account to delete your own account.' });
    }
    const deleted = await deleteOneSession(req, req.params.userId);
    if (!deleted) return res.status(404).json({ error: 'Session not found.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Multi-select delete from the admin screen: deletes exactly the logins the
// admin checked off, in one request. A ridiculous/duplicate/self id in the
// list is silently skipped rather than failing the whole batch - the
// response's counts tell the client what actually happened.
router.post('/sessions/bulk-delete', async (req, res, next) => {
  try {
    const userIds = Array.isArray(req.body.userIds) ? [...new Set(req.body.userIds)] : [];
    if (userIds.length === 0) {
      return res.status(400).json({ error: 'userIds is required.' });
    }
    let deletedCount = 0;
    for (const userId of userIds) {
      if (await deleteOneSession(req, userId)) deletedCount += 1;
    }
    res.json({ deletedCount, skippedCount: userIds.length - deletedCount });
  } catch (err) {
    next(err);
  }
});

// Bulk "cleanup": every guest login in one sweep. Guest sessions accumulate
// fastest - each guest sign-in creates a brand-new `users` row that's never
// reused - so this is the one case worth a dedicated bulk action rather than
// checking them all off by hand in the multi-select above.
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
