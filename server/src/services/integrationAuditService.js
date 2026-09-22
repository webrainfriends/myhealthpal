const pool = require('../db/pool');

// One row per Gmail integration action (connect/disconnect/search/import/
// sync/reauth_required/error). `detail` is operational metadata only
// (counts, message/attachment ids, error categories) - never OAuth tokens,
// email bodies or attachment content; callers must not pass those in.
async function logGmailAction(userId, action, { connectionId = null, detail = null } = {}) {
  await pool.query(
    `INSERT INTO integration_audit_log (user_id, connection_id, integration, action, detail)
     VALUES ($1, $2, 'gmail', $3, $4)`,
    [userId, connectionId, action, detail ? JSON.stringify(detail) : null]
  );
}

module.exports = { logGmailAction };
