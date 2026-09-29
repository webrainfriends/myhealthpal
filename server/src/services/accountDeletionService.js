const pool = require('../db/pool');
const { deleteStoredFile } = require('../security/secureUpload');
const audit = require('../security/auditLog');
const { logError } = require('../lib/safeLog');

// Tables that hold an encrypted file per row - their storage_object_key /
// storage_path must be unlinked from disk once the row (and its wrapped
// data key) is gone, same as reports.js's own DELETE /:id route.
const FILE_TABLES = ['reports', 'medication_scans', 'diet_scans', 'workout_video_asset'];

async function collectStoredFiles(client, userIds) {
  if (userIds.length === 0) return [];
  const rows = [];
  for (const table of FILE_TABLES) {
    const { rows: tableRows } = await client.query(
      `SELECT id, storage_object_key, storage_path FROM ${table} WHERE user_id = ANY($1::uuid[])`,
      [userIds]
    );
    rows.push(...tableRows);
  }
  return rows;
}

// Managed profiles this account is the *sole* manager of - deleting the
// account would otherwise orphan them (unreachable health data with no one
// left to view or manage it). Same orphan check as familyService.removeMember,
// just applied to every managed profile this account owns at once.
async function findSoleManagedProfiles(client, accountId) {
  const { rows } = await client.query(
    `SELECT u.id FROM family_links fl
     JOIN users u ON u.id = fl.member_user_id
     WHERE fl.owner_user_id = $1 AND fl.access = 'manage' AND u.auth_provider = 'managed'
       AND NOT EXISTS (
         SELECT 1 FROM family_links fl2
         WHERE fl2.member_user_id = fl.member_user_id AND fl2.owner_user_id <> $1 AND fl2.access = 'manage'
       )`,
    [accountId]
  );
  return rows.map((r) => r.id);
}

// Permanently deletes a signed-in account and everything that belongs to
// it: reports, measurements, medications, diet/activity logs, chat, AI
// usage attribution, family links, and any managed profile this account
// was the sole manager of (deleted right along with it, for the same
// reason removeMember deletes an orphaned managed profile). Auth is
// stateless JWT with no session table, so once the row is gone any token
// issued for it 401s on its own next use - there is nothing else session-
// like to revoke.
//
// `purpose` distinguishes a self-service deletion (routes/account.js,
// the default) from an admin-initiated one (routes/admin.js passes
// 'admin_cleanup') in the audit trail; either way audit.record's own
// actorUserId defaults to the requesting account from context, so an
// admin deleting someone else's account is recorded as doing so.
async function deleteAccount(accountId, { purpose = 'user_request' } = {}) {
  const client = await pool.connect();
  let filesToDelete;
  try {
    await client.query('BEGIN');
    const managedProfileIds = await findSoleManagedProfiles(client, accountId);
    filesToDelete = await collectStoredFiles(client, [accountId, ...managedProfileIds]);
    if (managedProfileIds.length > 0) {
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [managedProfileIds]);
    }
    await client.query('DELETE FROM users WHERE id = $1', [accountId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await Promise.all(
    filesToDelete.map((row) =>
      deleteStoredFile(row).catch((err) => {
        // The row (and its wrapped key) is already gone, so leftover
        // ciphertext is unreadable - disk space, not exposure.
        logError(`Could not remove stored file for deleted account ${accountId}`, err);
      })
    )
  );

  await audit.record({ eventType: 'ACCOUNT_DELETED', userId: accountId, purpose });
}

module.exports = { deleteAccount, FILE_TABLES };
