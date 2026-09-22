const pool = require('../db/pool');
const { encryptSecret, decryptSecret } = require('../lib/tokenCipher');

async function getConnectionByUserId(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_connections WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

// Re-authorizing (connecting again after disconnect, or Google's
// "always show consent" prompt on scope changes) must land on the same
// row rather than create a second connection for this user - upsert on the
// unique user_id, refreshing every credential/identity field.
async function upsertConnection({ userId, providerAccountId, emailAddress, scopes, refreshToken }) {
  const encryptedRefreshToken = encryptSecret(refreshToken);
  const { rows } = await pool.query(
    `INSERT INTO gmail_connections
       (user_id, provider_account_id, email_address, scopes, encrypted_refresh_token, status, connected_at, last_authorized_at)
     VALUES ($1, $2, $3, $4, $5, 'active', now(), now())
     ON CONFLICT (user_id) DO UPDATE SET
       provider_account_id = EXCLUDED.provider_account_id,
       email_address = EXCLUDED.email_address,
       scopes = EXCLUDED.scopes,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       status = 'active',
       last_error = NULL,
       revoked_at = NULL,
       last_authorized_at = now(),
       updated_at = now()
     RETURNING *`,
    [userId, providerAccountId, emailAddress, scopes.join(' '), encryptedRefreshToken]
  );
  return rows[0];
}

function decryptedRefreshToken(connection) {
  return decryptSecret(connection.encrypted_refresh_token);
}

async function markReauthRequired(connectionId, errorMessage) {
  await pool.query(
    `UPDATE gmail_connections SET status = 'reauth_required', last_error = $2, updated_at = now() WHERE id = $1`,
    [connectionId, errorMessage]
  );
}

async function recordSyncStart(connectionId) {
  await pool.query(`UPDATE gmail_connections SET last_sync_started_at = now(), updated_at = now() WHERE id = $1`, [
    connectionId,
  ]);
}

async function recordSyncCompletion(connectionId, { checkpoint, error }) {
  await pool.query(
    `UPDATE gmail_connections
     SET last_sync_completed_at = now(),
         last_sync_checkpoint = COALESCE($2, last_sync_checkpoint),
         last_error = $3,
         updated_at = now()
     WHERE id = $1`,
    [connectionId, checkpoint || null, error || null]
  );
}

async function setSyncMode(connectionId, syncMode) {
  const { rows } = await pool.query(
    `UPDATE gmail_connections SET sync_mode = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [connectionId, syncMode]
  );
  return rows[0];
}

// Revokes credentials but deliberately leaves the row (status
// 'disconnected', refresh token cleared) rather than deleting it - both for
// the audit trail and so previously imported reports/gmail_document_sources
// keep a valid connection_id to join against, per the "disconnecting must
// not silently delete imported records" requirement.
async function disconnect(connectionId) {
  await pool.query(
    `UPDATE gmail_connections
     SET status = 'disconnected', encrypted_refresh_token = NULL, revoked_at = now(), updated_at = now()
     WHERE id = $1`,
    [connectionId]
  );
}

module.exports = {
  getConnectionByUserId,
  upsertConnection,
  decryptedRefreshToken,
  markReauthRequired,
  recordSyncStart,
  recordSyncCompletion,
  setSyncMode,
  disconnect,
};
