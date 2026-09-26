const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const pool = require('../src/db/pool');
const gmailClient = require('../src/services/gmailClientService');
const gmailConnectionService = require('../src/services/gmailConnectionService');
const ingestionService = require('../src/services/ingestionService');
const { importSelections } = require('../src/services/gmailImportService');
const encryptedFileStore = require('../src/security/encryptedFileStore');
const consentService = require('../src/security/consentService');
const config = require('../src/config');
const path = require('path');

let userId;
let connection;
let restoreEnqueueProcessing;
const createdReportIds = [];

test.before(async () => {
  // This suite is about import/dedup/provenance, not extraction - the real
  // pipeline (adapters, extraction providers) is covered by its own tests.
  // Stubbed out so background processing of these fake attachment bytes
  // never races test.after's cleanup deletes for the reports created below.
  const originalEnqueueProcessing = ingestionService.enqueueProcessing;
  ingestionService.enqueueProcessing = () => {};
  restoreEnqueueProcessing = () => {
    ingestionService.enqueueProcessing = originalEnqueueProcessing;
  };

  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('gmail-import-test@example.com', 'Gmail Import Test') RETURNING id`
  );
  userId = user.rows[0].id;
  await consentService.setConsent({ userId, consentType: 'medical_record_storage', granted: true });
  connection = await gmailConnectionService.upsertConnection({
    userId,
    providerAccountId: 'google-sub-123',
    emailAddress: 'patient@gmail.com',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    refreshToken: 'fake-refresh-token',
  });
});

test.after(async () => {
  const { rows } = await pool.query('SELECT * FROM reports WHERE id = ANY($1)', [createdReportIds]);
  for (const row of rows) {
    await encryptedFileStore.remove(row).catch(() => {});
  }
  await pool.query('DELETE FROM gmail_document_sources WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM reports WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM gmail_connections WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  restoreEnqueueProcessing();
  await pool.end();
});

function mockClient({ messages, attachmentBytes }) {
  const originalGetMessage = gmailClient.getMessage;
  const originalGetAttachmentData = gmailClient.getAttachmentData;
  gmailClient.getMessage = async (accessToken, messageId) => messages[messageId];
  gmailClient.getAttachmentData = async (accessToken, messageId, attachmentId) => attachmentBytes(messageId, attachmentId);
  return () => {
    gmailClient.getMessage = originalGetMessage;
    gmailClient.getAttachmentData = originalGetAttachmentData;
  };
}

test('importSelections imports a new attachment into reports with Gmail provenance', async () => {
  const restore = mockClient({
    messages: {
      'msg-1': {
        id: 'msg-1',
        from: 'Quest Diagnostics <noreply@questdiagnostics.com>',
        subject: 'Your Blood Test results',
        receivedAt: new Date('2026-01-01T00:00:00Z'),
        attachments: [{ filename: 'results.pdf', mimeType: 'application/pdf', attachmentId: 'att-1' }],
      },
    },
    attachmentBytes: async () => Buffer.from('%PDF-1.4 fake report bytes'),
  });

  try {
    const results = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [{ messageId: 'msg-1', attachmentId: 'att-1' }],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'imported');
    createdReportIds.push(results[0].reportId);

    const report = await pool.query('SELECT * FROM reports WHERE id = $1', [results[0].reportId]);
    assert.equal(report.rows[0].source_type, 'gmail_import');
    assert.equal(report.rows[0].source_provider, 'Quest Diagnostics');
    assert.equal(report.rows[0].original_filename, 'results.pdf');
    // Stored only as ciphertext in the vault - no plaintext path at all.
    assert.equal(report.rows[0].storage_path, null);
    assert.equal(report.rows[0].encryption_version, 1);
    const objectFile = path.join(config.security.encryptedStoreDir, report.rows[0].storage_object_key);
    assert.ok(!fs.readFileSync(objectFile).includes(Buffer.from('fake report bytes')));
    const decrypted = await encryptedFileStore.readDecrypted(report.rows[0]);
    assert.equal(decrypted.toString(), '%PDF-1.4 fake report bytes');

    const source = await pool.query('SELECT * FROM gmail_document_sources WHERE imported_report_id = $1', [
      results[0].reportId,
    ]);
    assert.equal(source.rows[0].provider_message_id, 'msg-1');
    assert.equal(source.rows[0].provider_attachment_id, 'att-1');
    assert.equal(source.rows[0].sender, 'Quest Diagnostics <noreply@questdiagnostics.com>');
  } finally {
    restore();
  }
});

test('importSelections is idempotent: re-importing the same message/attachment reports a duplicate, not a second report', async () => {
  const restore = mockClient({
    messages: {
      'msg-2': {
        id: 'msg-2',
        from: 'lab@example.com',
        subject: 'Lipid panel',
        receivedAt: new Date(),
        attachments: [{ filename: 'lipid.pdf', mimeType: 'application/pdf', attachmentId: 'att-2' }],
      },
    },
    attachmentBytes: async () => Buffer.from('%PDF-1.4 lipid panel bytes'),
  });

  try {
    const first = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [{ messageId: 'msg-2', attachmentId: 'att-2' }],
    });
    createdReportIds.push(first[0].reportId);

    const second = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [{ messageId: 'msg-2', attachmentId: 'att-2' }],
    });

    assert.equal(second[0].status, 'duplicate');
    assert.equal(second[0].reportId, first[0].reportId);

    const count = await pool.query('SELECT count(*) FROM reports WHERE user_id = $1 AND original_filename = $2', [
      userId,
      'lipid.pdf',
    ]);
    assert.equal(Number(count.rows[0].count), 1);
  } finally {
    restore();
  }
});

test('importSelections detects duplicate content arriving under a different message/attachment id (checksum dedup)', async () => {
  const restore = mockClient({
    messages: {
      'msg-3': {
        id: 'msg-3',
        from: 'lab@example.com',
        subject: 'Thyroid panel',
        receivedAt: new Date(),
        attachments: [{ filename: 'thyroid.pdf', mimeType: 'application/pdf', attachmentId: 'att-3' }],
      },
      'msg-4-forward': {
        id: 'msg-4-forward',
        from: 'lab@example.com',
        subject: 'Fwd: Thyroid panel',
        receivedAt: new Date(),
        attachments: [{ filename: 'thyroid.pdf', mimeType: 'application/pdf', attachmentId: 'att-4' }],
      },
    },
    attachmentBytes: async () => Buffer.from('%PDF-1.4 identical thyroid bytes'),
  });

  try {
    const first = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [{ messageId: 'msg-3', attachmentId: 'att-3' }],
    });
    createdReportIds.push(first[0].reportId);

    const second = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [{ messageId: 'msg-4-forward', attachmentId: 'att-4' }],
    });

    assert.equal(second[0].status, 'duplicate');
    assert.equal(second[0].reportId, first[0].reportId);
  } finally {
    restore();
  }
});

test('importSelections reports an unsupported attachment type as an error without failing the rest of the batch', async () => {
  const restore = mockClient({
    messages: {
      'msg-5': {
        id: 'msg-5',
        from: 'lab@example.com',
        subject: 'Results',
        receivedAt: new Date(),
        attachments: [
          { filename: 'malware.exe', mimeType: 'application/octet-stream', attachmentId: 'att-5' },
          { filename: 'ok.pdf', mimeType: 'application/pdf', attachmentId: 'att-6' },
        ],
      },
    },
    attachmentBytes: async () => Buffer.from('%PDF-1.4 bytes'),
  });

  try {
    const results = await importSelections({
      userId,
      connection,
      accessToken: 'token',
      selections: [
        { messageId: 'msg-5', attachmentId: 'att-5' },
        { messageId: 'msg-5', attachmentId: 'att-6' },
      ],
    });

    assert.equal(results[0].status, 'error');
    assert.match(results[0].error, /Unsupported file type/);
    assert.equal(results[1].status, 'imported');
    createdReportIds.push(results[1].reportId);
  } finally {
    restore();
  }
});
