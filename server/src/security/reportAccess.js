const pool = require('../db/pool');
const audit = require('./auditLog');

// The single ownership check every report operation goes through (issue
// #104 §7): the row must belong to the request's user (the signed-in
// account, or a family profile it was granted - see middleware/auth.js)
// before anything about it is read, decrypted or changed. A report that
// exists but belongs to someone else is indistinguishable from a missing
// one to the caller, and is recorded as ACCESS_DENIED.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOwnedReport(userId, reportId, { purpose = 'report_access' } = {}) {
  if (!userId || !UUID_RE.test(String(reportId || ''))) return null;
  const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [reportId, userId]);
  if (rows[0]) return rows[0];
  const exists = await pool.query('SELECT 1 FROM reports WHERE id = $1', [reportId]);
  if (exists.rows.length > 0) {
    await audit.record({ eventType: 'ACCESS_DENIED', userId, reportId, purpose });
  }
  return null;
}

module.exports = { loadOwnedReport, UUID_RE };

// Storage and key metadata never leaves the server: the wrapped key, IV,
// tag, object key and legacy path are useless to a client and would only
// widen what a leaked response exposes.
const PRIVATE_COLUMNS = [
  'storage_path',
  'storage_object_key',
  'encrypted_data_key',
  'key_provider',
  'key_reference',
  'key_version',
  'cipher_iv',
  'cipher_auth_tag',
  'ciphertext_sha256',
  'cipher_algorithm',
  'legacy_migration_status',
];

function toPublicRecord(row) {
  if (!row) return row;
  const out = { ...row };
  for (const col of PRIVATE_COLUMNS) delete out[col];
  out.encrypted = Boolean(row.encryption_version);
  delete out.encryption_version;
  delete out.encrypted_at;
  return out;
}

module.exports.toPublicRecord = toPublicRecord;
module.exports.PRIVATE_COLUMNS = PRIVATE_COLUMNS;
