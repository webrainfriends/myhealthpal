const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const { extensionOf } = require('../middleware/upload');
const gmailClient = require('./gmailClientService');
const ingestionService = require('./ingestionService');
const { secureStore, encryptionInsertParts } = require('../security/secureUpload');
const encryptedFileStore = require('../security/encryptedFileStore');
const { requireConsent } = require('../security/consentService');

// "Quest Diagnostics <noreply@questdiagnostics.com>" -> "Quest Diagnostics";
// a bare "noreply@questdiagnostics.com" is returned as-is. Used only for
// the report's source_provider display field, exactly like a manually
// typed lab name would be.
function senderDisplayName(from) {
  if (!from) return null;
  const match = from.match(/^"?([^"<]+)"?\s*<[^>]+>$/);
  return match ? match[1].trim() : from.trim();
}

async function findExistingSource(connectionId, messageId, attachmentId) {
  const { rows } = await pool.query(
    `SELECT * FROM gmail_document_sources WHERE connection_id = $1 AND provider_message_id = $2 AND provider_attachment_id = $3`,
    [connectionId, messageId, attachmentId]
  );
  return rows[0] || null;
}

async function findExistingByChecksum(userId, checksum) {
  const { rows } = await pool.query(`SELECT * FROM gmail_document_sources WHERE user_id = $1 AND checksum = $2`, [
    userId,
    checksum,
  ]);
  return rows[0] || null;
}

async function importOne({ userId, connection, accessToken, messageId, attachmentId, messageCache }) {
  const existing = await findExistingSource(connection.id, messageId, attachmentId);
  if (existing) {
    return { messageId, attachmentId, status: 'duplicate', reportId: existing.imported_report_id };
  }

  let message = messageCache.get(messageId);
  if (!message) {
    message = await gmailClient.getMessage(accessToken, messageId);
    messageCache.set(messageId, message);
  }

  const attachment = message.attachments.find((a) => a.attachmentId === attachmentId);
  if (!attachment) {
    return { messageId, attachmentId, status: 'error', error: 'Attachment no longer exists in the source message.' };
  }

  const extension = extensionOf(attachment.filename);
  if (!config.supportedExtensions[extension]) {
    return {
      messageId,
      attachmentId,
      status: 'error',
      error: `Unsupported file type ".${extension || 'unknown'}".`,
    };
  }

  const bytes = await gmailClient.getAttachmentData(accessToken, messageId, attachmentId);
  if (bytes.length === 0) {
    return { messageId, attachmentId, status: 'error', error: 'The attachment is empty.' };
  }
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

  const duplicateByContent = await findExistingByChecksum(userId, checksum);
  if (duplicateByContent) {
    // Same bytes already imported under a different message/attachment id
    // (e.g. a forwarded copy) - record the mapping so a future re-scan of
    // *this* message/attachment short-circuits via findExistingSource
    // above without downloading and hashing it again, but never create a
    // second report for content already on the user's timeline.
    await pool.query(
      `INSERT INTO gmail_document_sources
         (user_id, connection_id, provider_message_id, provider_attachment_id, checksum, sender, subject, received_at, original_filename, mime_type, imported_report_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (connection_id, provider_message_id, provider_attachment_id) DO NOTHING`,
      [
        userId,
        connection.id,
        messageId,
        attachmentId,
        checksum,
        message.from,
        message.subject,
        message.receivedAt,
        attachment.filename,
        attachment.mimeType,
        duplicateByContent.imported_report_id,
      ]
    );
    return { messageId, attachmentId, status: 'duplicate', reportId: duplicateByContent.imported_report_id };
  }

  // Same path as a direct upload: consent, content validation, malware
  // scan, then encrypted straight from memory - never written as plaintext.
  await requireConsent(userId, 'medical_record_storage');
  const meta = await secureStore({ userId, buffer: bytes, extension });

  try {
    const enc = encryptionInsertParts(meta, 7);
    const { rows } = await pool.query(
      `INSERT INTO reports
         (user_id, original_filename, mime_type, file_extension, file_size_bytes, source_type, source_provider, ${enc.columns.join(', ')})
       VALUES ($1, $2, $3, $4, $5, 'gmail_import', $6, ${enc.placeholders.join(', ')})
       RETURNING id`,
      [
        userId,
        attachment.filename,
        attachment.mimeType || 'application/octet-stream',
        extension,
        bytes.length,
        senderDisplayName(message.from),
        ...enc.values,
      ]
    );
    const reportId = rows[0].id;

    await pool.query(
      `INSERT INTO gmail_document_sources
         (user_id, connection_id, provider_message_id, provider_attachment_id, checksum, sender, subject, received_at, original_filename, mime_type, imported_report_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        userId,
        connection.id,
        messageId,
        attachmentId,
        checksum,
        message.from,
        message.subject,
        message.receivedAt,
        attachment.filename,
        attachment.mimeType,
        reportId,
      ]
    );

    ingestionService.enqueueProcessing(reportId);
    return { messageId, attachmentId, status: 'imported', reportId };
  } catch (err) {
    await encryptedFileStore.remove(meta).catch(() => {});
    throw err;
  }
}

// Imports every selected {messageId, attachmentId} pair, one at a time -
// one failed attachment (unsupported type, corrupted download, a message
// that no longer has that attachment) is reported per-item and never fails
// the rest of the batch. `messageCache` avoids re-fetching the same
// message's metadata when several of its attachments are selected together.
async function importSelections({ userId, connection, accessToken, selections }) {
  const messageCache = new Map();
  const results = [];
  for (const selection of selections) {
    // eslint-disable-next-line no-await-in-loop
    const result = await importOne({
      userId,
      connection,
      accessToken,
      messageId: selection.messageId,
      attachmentId: selection.attachmentId,
      messageCache,
    });
    results.push(result);
  }
  return results;
}

module.exports = { importSelections, senderDisplayName };
