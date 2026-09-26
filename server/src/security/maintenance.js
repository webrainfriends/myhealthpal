const crypto = require('crypto');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const store = require('./encryptedFileStore');
const { getKeyProvider } = require('./keyProvider');
const { CURRENT_VERSION } = require('./cipherVersions');
const audit = require('./auditLog');

// Batch maintenance for the encrypted vault (issue #104 §9-10 and the
// legacy migration). Each job is idempotent and resumable, and reports
// counts only - never filenames, paths or contents.

const FILE_TABLES = [
  { table: 'reports', resourceType: 'report' },
  { table: 'medication_scans', resourceType: 'medication_scan' },
  { table: 'diet_scans', resourceType: 'diet_scan' },
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function setEncryptionSql(meta, startIndex) {
  const cols = store.toColumns(meta);
  return {
    assignments: cols.map(([c], i) => `${c} = $${startIndex + i}`).join(', '),
    values: cols.map(([, v]) => v),
  };
}

// ---- Legacy plaintext -> encrypted ---------------------------------------

// Encrypts every legacy plaintext upload. Per file: encrypt -> record
// metadata -> verify by decrypting and comparing checksums -> only then
// delete the plaintext. A crash at any point leaves either the plaintext
// (retried next run) or a verified ciphertext plus plaintext (finished next
// run) - never neither.
async function encryptLegacyUploads({ dryRun = false, batchSize = 50 } = {}) {
  const summary = {};
  for (const { table, resourceType } of FILE_TABLES) {
    const counts = { pending: 0, encrypted: 0, finished: 0, missing: 0, failed: 0 };
    summary[table] = counts;

    const pendingCount = await pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE storage_path IS NOT NULL AND (encryption_version IS NULL OR legacy_migration_status = 'verifying')`
    );
    counts.pending = pendingCount.rows[0].n;
    if (dryRun) continue;

    // Rows already encrypted and verified but whose plaintext removal was
    // interrupted: verify again, then finish.
    const { rows: unfinished } = await pool.query(
      `SELECT * FROM ${table} WHERE storage_path IS NOT NULL AND encryption_version IS NOT NULL`
    );
    for (const row of unfinished) {
      try {
        const plaintext = await fs.promises.readFile(row.storage_path).catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));
        if (plaintext) {
          const decrypted = await store.readDecrypted(row, { userId: row.user_id });
          if (sha256(decrypted) !== sha256(plaintext)) throw new Error('verification mismatch');
          await fs.promises.unlink(row.storage_path);
        }
        await pool.query(`UPDATE ${table} SET storage_path = NULL, legacy_migration_status = 'done' WHERE id = $1`, [row.id]);
        counts.finished += 1;
      } catch (err) {
        counts.failed += 1;
      }
    }

    for (;;) {
      const { rows } = await pool.query(
        `SELECT * FROM ${table}
         WHERE storage_path IS NOT NULL AND encryption_version IS NULL
           AND COALESCE(legacy_migration_status, 'pending') NOT IN ('missing', 'failed')
         ORDER BY created_at ASC LIMIT $1`,
        [batchSize]
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        let plaintext;
        try {
          plaintext = await fs.promises.readFile(row.storage_path);
        } catch (err) {
          const status = err.code === 'ENOENT' ? 'missing' : 'failed';
          await pool.query(`UPDATE ${table} SET legacy_migration_status = $2 WHERE id = $1`, [row.id, status]);
          counts[status === 'missing' ? 'missing' : 'failed'] += 1;
          continue;
        }

        let meta;
        try {
          meta = await store.put({ userId: row.user_id, buffer: plaintext });
          const { assignments, values } = setEncryptionSql(meta, 2);
          const updated = await pool.query(
            `UPDATE ${table} SET ${assignments}, encrypted_at = now(), legacy_migration_status = 'verifying'
             WHERE id = $1 AND encryption_version IS NULL`,
            [row.id, ...values]
          );
          if (updated.rowCount === 0) {
            await store.remove(meta);
            continue; // someone else migrated it concurrently
          }
          const decrypted = await store.readDecrypted(meta, { userId: row.user_id });
          if (sha256(decrypted) !== sha256(plaintext)) throw new Error('verification mismatch');

          await fs.promises.unlink(row.storage_path);
          await pool.query(`UPDATE ${table} SET storage_path = NULL, legacy_migration_status = 'done' WHERE id = $1`, [row.id]);
          await audit.record({
            eventType: 'LEGACY_FILE_ENCRYPTED',
            userId: row.user_id,
            reportId: table === 'reports' ? row.id : null,
            resourceType,
            actorType: 'system',
          });
          counts.encrypted += 1;
        } catch (err) {
          // Roll this row back to its untouched legacy state.
          const nulls = store.COLUMNS.map(([c]) => `${c} = NULL`).join(', ');
          await pool.query(
            `UPDATE ${table} SET ${nulls}, encrypted_at = NULL, legacy_migration_status = 'failed' WHERE id = $1 AND storage_path IS NOT NULL`,
            [row.id]
          );
          if (meta) await store.remove(meta).catch(() => {});
          counts.failed += 1;
        }
      }
    }
  }
  return summary;
}

// ---- KEK rotation ---------------------------------------------------------

// Re-wraps every data key not yet under the provider's current key (e.g.
// after pointing KMS_KEY_ID at a new key). Files are untouched - only the
// small wrapped keys change.
async function rewrapKeys({ dryRun = false } = {}) {
  const provider = getKeyProvider();
  const current = await provider.currentKeyReference();
  const summary = {};
  for (const { table, resourceType } of FILE_TABLES) {
    const { rows } = await pool.query(
      `SELECT id, user_id, storage_object_key, encrypted_data_key, key_reference
       FROM ${table}
       WHERE encryption_version IS NOT NULL AND key_provider = $1 AND key_version IS DISTINCT FROM $2`,
      [provider.name, current]
    );
    summary[table] = { toRewrap: rows.length, rewrapped: 0, failed: 0 };
    if (dryRun) continue;
    for (const row of rows) {
      try {
        const ctx = { userId: row.user_id, objectKey: row.storage_object_key };
        const out = await provider.rewrapDataKey(row.encrypted_data_key, row.key_reference, ctx);
        await pool.query(
          `UPDATE ${table} SET encrypted_data_key = $2, key_reference = $3, key_version = $4 WHERE id = $1 AND encrypted_data_key = $5`,
          [row.id, out.wrappedKey, out.keyReference, out.keyVersion, row.encrypted_data_key]
        );
        await audit.record({
          eventType: 'KEY_REWRAPPED',
          userId: row.user_id,
          reportId: table === 'reports' ? row.id : null,
          resourceType,
          actorType: 'system',
        });
        summary[table].rewrapped += 1;
      } catch (err) {
        summary[table].failed += 1;
      }
    }
  }
  return summary;
}

// ---- Cipher-version migration ------------------------------------------

// Re-encrypts files written with an older encryption_version under the
// current one: decrypt (old scheme) -> encrypt (new scheme, new DEK) ->
// verify -> swap metadata -> remove the old object.
async function reencryptFiles({ dryRun = false } = {}) {
  const summary = {};
  for (const { table, resourceType } of FILE_TABLES) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE encryption_version IS NOT NULL AND encryption_version <> $1`,
      [CURRENT_VERSION]
    );
    summary[table] = { toReencrypt: rows.length, reencrypted: 0, failed: 0 };
    if (dryRun) continue;
    for (const row of rows) {
      let meta;
      try {
        const plaintext = await store.readDecrypted(row, { userId: row.user_id });
        meta = await store.put({ userId: row.user_id, buffer: plaintext });
        const check = await store.readDecrypted(meta, { userId: row.user_id });
        if (sha256(check) !== sha256(plaintext)) throw new Error('verification mismatch');
        const { assignments, values } = setEncryptionSql(meta, 3);
        const updated = await pool.query(
          `UPDATE ${table} SET ${assignments}, encrypted_at = now() WHERE id = $1 AND storage_object_key = $2`,
          [row.id, row.storage_object_key, ...values]
        );
        if (updated.rowCount === 0) throw new Error('row changed concurrently');
        await store.remove(row);
        await audit.record({
          eventType: 'FILE_REENCRYPTED',
          userId: row.user_id,
          reportId: table === 'reports' ? row.id : null,
          resourceType,
          actorType: 'system',
        });
        summary[table].reencrypted += 1;
      } catch (err) {
        if (meta) await store.remove(meta).catch(() => {});
        summary[table].failed += 1;
      }
    }
  }
  return summary;
}

// ---- Retention -------------------------------------------------------------

// Purges medication/diet scan files older than the configured retention
// (RETENTION_UNCONFIRMED_SCAN_DAYS) together with any items from them that
// were never confirmed. Confirmed items the person kept stay. Off unless
// configured.
async function purgeExpiredScans({ days = config.security.retentionUnconfirmedScanDays } = {}) {
  if (!days) return { skipped: true };
  const summary = {};
  for (const [table, child] of [
    ['medication_scans', 'medications'],
    ['diet_scans', 'food_entries'],
  ]) {
    const { rows } = await pool.query(
      `SELECT * FROM ${table} WHERE created_at < now() - ($1 || ' days')::interval AND ingestion_status <> 'Processing'`,
      [String(days)]
    );
    for (const row of rows) {
      await pool.query(`DELETE FROM ${child} WHERE scan_id = $1 AND is_confirmed = false`, [row.id]);
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);
      if (row.storage_object_key) await store.remove(row).catch(() => {});
      if (row.storage_path) await fs.promises.unlink(row.storage_path).catch(() => {});
      await audit.record({
        eventType: 'REPORT_DELETED',
        userId: row.user_id,
        resourceType: table === 'medication_scans' ? 'medication_scan' : 'diet_scan',
        purpose: 'retention_policy',
        actorType: 'system',
      });
    }
    summary[table] = { purged: rows.length };
  }
  return summary;
}

// ---- Key service health check ---------------------------------------------

// Round-trips a data key through the configured provider - used by deploys
// to confirm the instance can reach KMS before switching versions.
async function checkKeyProvider() {
  const provider = getKeyProvider();
  const ctx = { userId: '00000000-0000-0000-0000-000000000000', objectKey: 'health-check' };
  const { plaintextKey, wrappedKey, keyReference } = await provider.generateDataKey(ctx);
  const unwrapped = await provider.unwrapDataKey(wrappedKey, keyReference, ctx);
  const ok = unwrapped.equals(plaintextKey);
  plaintextKey.fill(0);
  unwrapped.fill(0);
  if (!ok) throw new Error('Key provider round-trip returned a different key');
  return { provider: provider.name, keyReference: await provider.currentKeyReference() };
}

module.exports = { encryptLegacyUploads, rewrapKeys, reencryptFiles, purgeExpiredScans, checkKeyProvider, FILE_TABLES };
