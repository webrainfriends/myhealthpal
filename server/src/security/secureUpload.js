const fs = require('fs');
const config = require('../config');
const store = require('./encryptedFileStore');
const { validateContent } = require('./fileSniffer');
const { inspectZip } = require('./zipGuard');
const malwareScanner = require('./malwareScanner');
const audit = require('./auditLog');

// The one path every uploaded medical file takes (reports, medication
// scans, diet scans, Gmail imports): validate the bytes, scan, encrypt,
// and hand back the metadata to store on the row. The plaintext only ever
// exists in memory; nothing is written to disk unencrypted.

class UploadRejectedError extends Error {
  constructor(message) {
    super(message);
    this.code = 'upload_rejected';
    this.status = 400;
  }
}

async function validateAndScan(buffer, extension) {
  const contentProblem = validateContent(buffer, extension);
  if (contentProblem) throw new UploadRejectedError(contentProblem);
  if (extension === 'docx' || extension === 'xlsx') {
    const zipProblem = inspectZip(buffer);
    if (zipProblem) throw new UploadRejectedError(zipProblem);
  }
  let result;
  try {
    result = await malwareScanner.scan(buffer);
  } catch (err) {
    // Fail closed: an unavailable scanner rejects rather than skips.
    throw new UploadRejectedError('The file could not be safety-scanned right now. Please try again later.');
  }
  if (!result.clean) throw new UploadRejectedError('The file was flagged by the malware scanner and rejected.');
}

// Returns the encryption metadata for the row, plus a helper that turns it
// into SQL columns/values.
async function secureStore({ userId, buffer, extension }) {
  try {
    await validateAndScan(buffer, extension);
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      await audit.record({ eventType: 'UPLOAD_REJECTED', userId, purpose: extension });
    }
    throw err;
  }
  return store.put({ userId, buffer });
}

// Column list / values for an INSERT, appended after the caller's own.
function encryptionInsertParts(meta, startIndex) {
  const cols = store.toColumns(meta);
  return {
    columns: [...cols.map(([c]) => c), 'encrypted_at'],
    placeholders: [...cols.map((_, i) => `$${startIndex + i}`), 'now()'],
    values: cols.map(([, v]) => v),
  };
}

// Decrypts a row's file for processing or viewing. Legacy plaintext rows
// are readable only while LEGACY_PLAINTEXT_READS=allow (before the
// migration script has run); otherwise they fail closed.
async function loadFileBuffer(row, { purpose, resourceType = 'report' } = {}) {
  if (row.encryption_version != null) {
    const buffer = await store.readDecrypted(row, { userId: row.user_id });
    if (purpose) {
      await audit.record({
        eventType: 'REPORT_DECRYPTED_FOR_PROCESSING',
        userId: row.user_id,
        reportId: resourceType === 'report' ? row.id : null,
        resourceType,
        purpose,
      });
    }
    return buffer;
  }
  if (row.storage_path && config.security.legacyPlaintextReads === 'allow') {
    return fs.promises.readFile(row.storage_path);
  }
  throw new Error('File is not available in the encrypted store');
}

// Permanently removes a row's stored file (ciphertext, or a not-yet-migrated
// legacy plaintext file).
async function deleteStoredFile(row) {
  if (row.storage_object_key) await store.remove(row);
  if (row.storage_path) {
    await fs.promises.unlink(row.storage_path).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}

module.exports = {
  UploadRejectedError,
  validateAndScan,
  secureStore,
  encryptionInsertParts,
  loadFileBuffer,
  deleteStoredFile,
};
