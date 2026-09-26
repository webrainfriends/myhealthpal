const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../src/db/pool');
const config = require('../src/config');
const store = require('../src/security/encryptedFileStore');
const { setKeyProvider, getKeyProvider } = require('../src/security/keyProvider');
const { createLocalDevProvider } = require('../src/security/providers/localDev');
const { registerVersion, CURRENT_VERSION } = require('../src/security/cipherVersions');
const { validateSecurityConfig } = require('../src/security/configValidation');
const maintenance = require('../src/security/maintenance');

// Envelope encryption, key handling and vault maintenance (issue #104).
// Uses the local-dev provider with a random master key and a temp store.

const USER = '11111111-2222-3333-4444-555555555555';
let tempDir;
let originalStoreDir;

function provider(keyVersion = 'local-dev-v1', masterKeyHex = config.security.localDevMasterKey) {
  return createLocalDevProvider({ masterKeyHex, nodeEnv: 'test', keyVersion });
}

test.before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  originalStoreDir = config.security.encryptedStoreDir;
  config.security.encryptedStoreDir = tempDir;
  if (!config.security.localDevMasterKey) config.security.localDevMasterKey = crypto.randomBytes(32).toString('hex');
  setKeyProvider(provider());
});

test.after(async () => {
  config.security.encryptedStoreDir = originalStoreDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
  await pool.end();
});

test('put stores only ciphertext and readDecrypted round-trips', async () => {
  const plaintext = Buffer.from('Hemoglobin 13.2 g/dL - patient report');
  const meta = await store.put({ userId: USER, buffer: plaintext });
  const onDisk = fs.readFileSync(path.join(tempDir, meta.storageObjectKey));
  assert.ok(!onDisk.includes(Buffer.from('Hemoglobin')), 'no plaintext on disk');
  assert.equal(onDisk.length, plaintext.length);
  assert.equal((fs.statSync(path.join(tempDir, meta.storageObjectKey)).mode & 0o777).toString(8), '600');
  assert.equal(meta.cipherAlgorithm, 'aes-256-gcm');
  assert.equal(meta.cipherIv.length, 12);
  assert.equal(meta.cipherAuthTag.length, 16);
  assert.deepEqual(await store.readDecrypted(meta, { userId: USER }), plaintext);
});

test('each file gets a distinct data key and IV', async () => {
  const a = await store.put({ userId: USER, buffer: Buffer.from('same') });
  const b = await store.put({ userId: USER, buffer: Buffer.from('same') });
  assert.notDeepEqual(a.encryptedDataKey, b.encryptedDataKey);
  assert.notDeepEqual(a.cipherIv, b.cipherIv);
  assert.notEqual(a.storageObjectKey, b.storageObjectKey);
  const ka = await getKeyProvider().unwrapDataKey(a.encryptedDataKey, a.keyReference, { userId: USER, objectKey: a.storageObjectKey });
  const kb = await getKeyProvider().unwrapDataKey(b.encryptedDataKey, b.keyReference, { userId: USER, objectKey: b.storageObjectKey });
  assert.equal(ka.length, 32);
  assert.notDeepEqual(ka, kb);
});

test('tampering with ciphertext, tag, IV or checksum fails closed', async () => {
  const meta = await store.put({ userId: USER, buffer: Buffer.from('sensitive lab values') });
  const file = path.join(tempDir, meta.storageObjectKey);

  const flippedTag = Buffer.from(meta.cipherAuthTag);
  flippedTag[0] ^= 1;
  await assert.rejects(store.readDecrypted({ ...meta, cipherAuthTag: flippedTag }, { userId: USER }));

  const flippedIv = Buffer.from(meta.cipherIv);
  flippedIv[0] ^= 1;
  await assert.rejects(store.readDecrypted({ ...meta, cipherIv: flippedIv }, { userId: USER }));

  // Tampered bytes with the checksum "fixed up" still fail the GCM tag.
  const bytes = fs.readFileSync(file);
  bytes[0] ^= 1;
  fs.writeFileSync(file, bytes);
  await assert.rejects(store.readDecrypted(meta, { userId: USER }), /integrity/);
  const fixedChecksum = crypto.createHash('sha256').update(bytes).digest('hex');
  await assert.rejects(store.readDecrypted({ ...meta, ciphertextSha256: fixedChecksum }, { userId: USER }), /could not be decrypted/);
});

test('ciphertext and keys are bound to their owner and object', async () => {
  const meta = await store.put({ userId: USER, buffer: Buffer.from('owner-bound') });
  await assert.rejects(store.readDecrypted(meta, { userId: '99999999-2222-3333-4444-555555555555' }));
  // A wrapped key moved onto another object's metadata doesn't unwrap.
  const other = await store.put({ userId: USER, buffer: Buffer.from('other') });
  await assert.rejects(store.readDecrypted({ ...other, encryptedDataKey: meta.encryptedDataKey }, { userId: USER }));
});

test('a different master key cannot unwrap existing keys', async () => {
  const meta = await store.put({ userId: USER, buffer: Buffer.from('kek-bound') });
  setKeyProvider(provider('local-dev-v1', crypto.randomBytes(32).toString('hex')));
  try {
    await assert.rejects(store.readDecrypted(meta, { userId: USER }));
  } finally {
    setKeyProvider(provider());
  }
});

test('local-dev provider refuses production and bad master keys', () => {
  assert.throws(() => createLocalDevProvider({ masterKeyHex: 'ab'.repeat(32), nodeEnv: 'production' }), /not allowed in production/);
  assert.throws(() => createLocalDevProvider({ masterKeyHex: 'short', nodeEnv: 'development' }), /64 hex/);
});

test('production config validation requires AWS KMS and an explicit store', () => {
  const base = { ...config, nodeEnv: 'production', security: { ...config.security, encryptedStoreDir: tempDir } };
  const saved = process.env.ENCRYPTED_STORE_DIR;
  delete process.env.ENCRYPTED_STORE_DIR;
  try {
    const localDev = validateSecurityConfig({ ...base, security: { ...base.security, keyProvider: 'local-dev' } });
    assert.ok(localDev.some((p) => /KEY_PROVIDER must be "aws-kms"/.test(p)));
    assert.ok(localDev.some((p) => /LOCAL_DEV_MASTER_KEY must not be set/.test(p)));
    assert.ok(localDev.some((p) => /ENCRYPTED_STORE_DIR must be set/.test(p)));
    const noKey = validateSecurityConfig({ ...base, security: { ...base.security, keyProvider: 'aws-kms', kmsKeyId: null, localDevMasterKey: null } });
    assert.ok(noKey.some((p) => /KMS_KEY_ID is required/.test(p)));
    const legacy = validateSecurityConfig({ ...base, security: { ...base.security, legacyPlaintextReads: 'allow' } });
    assert.ok(legacy.some((p) => /LEGACY_PLAINTEXT_READS/.test(p)));
  } finally {
    if (saved !== undefined) process.env.ENCRYPTED_STORE_DIR = saved;
  }
});

test('the AWS KMS provider binds an encryption context to every call', async () => {
  const { createAwsKmsProvider } = require('../src/security/providers/awsKms');
  const sent = [];
  const fakeClient = {
    async send(command) {
      sent.push(command);
      const name = command.constructor.name;
      if (name === 'GenerateDataKeyCommand') return { Plaintext: Buffer.alloc(32, 7), CiphertextBlob: Buffer.from('wrapped'), KeyId: 'arn:aws:kms:k1' };
      if (name === 'DecryptCommand') return { Plaintext: Buffer.alloc(32, 7) };
      if (name === 'ReEncryptCommand') return { CiphertextBlob: Buffer.from('rewrapped'), KeyId: 'arn:aws:kms:k2' };
      throw new Error(name);
    },
  };
  const kms = createAwsKmsProvider({ keyId: 'alias/test', region: 'ap-southeast-1', client: fakeClient });
  const ctx = { userId: USER, objectKey: 'obj-1' };
  const dk = await kms.generateDataKey(ctx);
  assert.equal(dk.keyReference, 'arn:aws:kms:k1');
  await kms.unwrapDataKey(dk.wrappedKey, dk.keyReference, ctx);
  const re = await kms.rewrapDataKey(dk.wrappedKey, dk.keyReference, ctx);
  assert.equal(re.keyVersion, 'arn:aws:kms:k2');
  assert.deepEqual(sent[0].input.EncryptionContext, { app: 'myhealthpal', userId: USER, objectKey: 'obj-1' });
  assert.equal(sent[0].input.KeySpec, 'AES_256');
  assert.deepEqual(sent[1].input.EncryptionContext, sent[0].input.EncryptionContext);
  assert.deepEqual(sent[2].input.DestinationEncryptionContext, sent[0].input.EncryptionContext);
});

// ---- Database-backed maintenance ----------------------------------------

let dbUserId;

async function insertReport(fields) {
  const cols = Object.keys(fields);
  const { rows } = await pool.query(
    `INSERT INTO reports (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(fields)
  );
  return rows[0];
}

async function insertEncryptedReport(content) {
  const meta = await store.put({ userId: dbUserId, buffer: Buffer.from(content) });
  const parts = Object.fromEntries(store.toColumns(meta));
  return insertReport({
    user_id: dbUserId,
    original_filename: 'r.csv',
    mime_type: 'text/csv',
    file_extension: 'csv',
    file_size_bytes: content.length,
    ...parts,
  });
}

test('db: maintenance jobs', async (t) => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('Vault Test') RETURNING id`);
  dbUserId = user.rows[0].id;
  t.after(async () => {
    await pool.query('DELETE FROM reports WHERE user_id = $1', [dbUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [dbUserId]);
  });

  await t.test('raw data keys never appear in the database', async () => {
    const report = await insertEncryptedReport('Glucose,95,mg/dL');
    const key = await getKeyProvider().unwrapDataKey(report.encrypted_data_key, report.key_reference, {
      userId: dbUserId,
      objectKey: report.storage_object_key,
    });
    const { rows } = await pool.query('SELECT row_to_json(r)::text AS j, encrypted_data_key, cipher_iv, cipher_auth_tag FROM reports r WHERE id = $1', [report.id]);
    const blob = Buffer.concat([Buffer.from(rows[0].j), rows[0].encrypted_data_key, rows[0].cipher_iv, rows[0].cipher_auth_tag]);
    assert.ok(!blob.includes(key), 'raw DEK bytes found');
    assert.ok(!rows[0].j.includes(key.toString('hex')), 'raw DEK hex found');
    assert.ok(!rows[0].j.includes(key.toString('base64')), 'raw DEK base64 found');
  });

  await t.test('legacy plaintext uploads are encrypted, verified, then removed (idempotent)', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
    const legacyPath = path.join(legacyDir, 'old.csv');
    fs.writeFileSync(legacyPath, 'Vitamin D,14,ng/mL');
    const legacy = await insertReport({
      user_id: dbUserId,
      original_filename: 'old.csv',
      mime_type: 'text/csv',
      file_extension: 'csv',
      file_size_bytes: 18,
      storage_path: legacyPath,
      legacy_migration_status: 'pending',
    });
    const missing = await insertReport({
      user_id: dbUserId,
      original_filename: 'gone.csv',
      mime_type: 'text/csv',
      file_extension: 'csv',
      file_size_bytes: 1,
      storage_path: path.join(legacyDir, 'gone.csv'),
    });

    const dry = await maintenance.encryptLegacyUploads({ dryRun: true });
    assert.ok(dry.reports.pending >= 2);
    assert.ok(fs.existsSync(legacyPath), 'dry run changes nothing');
    assert.ok(!JSON.stringify(dry).includes('old.csv'), 'dry run reports counts only');

    const first = await maintenance.encryptLegacyUploads();
    assert.ok(first.reports.encrypted >= 1);
    assert.ok(!fs.existsSync(legacyPath), 'plaintext removed after verification');

    const { rows } = await pool.query('SELECT * FROM reports WHERE id = ANY($1)', [[legacy.id, missing.id]]);
    const migrated = rows.find((r) => r.id === legacy.id);
    assert.equal(migrated.storage_path, null);
    assert.equal(migrated.legacy_migration_status, 'done');
    assert.equal((await store.readDecrypted(migrated)).toString(), 'Vitamin D,14,ng/mL');
    assert.equal(rows.find((r) => r.id === missing.id).legacy_migration_status, 'missing');

    const second = await maintenance.encryptLegacyUploads();
    assert.equal(second.reports.encrypted, 0, 'second run is a no-op');
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });

  await t.test('KEK rotation re-wraps data keys without touching files', async () => {
    const report = await insertEncryptedReport('Ferritin,40,ng/mL');
    const before = fs.readFileSync(path.join(tempDir, report.storage_object_key));
    setKeyProvider(provider('local-dev-v2'));
    try {
      const dry = await maintenance.rewrapKeys({ dryRun: true });
      assert.ok(dry.reports.toRewrap >= 1);
      // (Counts span the whole shared test database; assertions below are
      // about this test's own row.)
      await maintenance.rewrapKeys();
      const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [report.id]);
      assert.equal(rows[0].key_version, 'local-dev-v2');
      assert.notDeepEqual(rows[0].encrypted_data_key, report.encrypted_data_key);
      assert.deepEqual(fs.readFileSync(path.join(tempDir, report.storage_object_key)), before);
      assert.equal((await store.readDecrypted(rows[0])).toString(), 'Ferritin,40,ng/mL');
      const remaining = await pool.query(
        `SELECT count(*)::int AS n FROM reports WHERE user_id = $1 AND encryption_version IS NOT NULL AND key_version IS DISTINCT FROM 'local-dev-v2'`,
        [dbUserId]
      );
      assert.equal(remaining.rows[0].n, 0, 'every key of this user re-wrapped');
    } finally {
      setKeyProvider(provider());
    }
  });

  await t.test('cipher-version migration re-encrypts older files', async () => {
    // A stub "v0" scheme stands in for an older format.
    const v1 = require('../src/security/cipherVersions').getVersion(1);
    registerVersion(0, { ...v1, algorithm: 'aes-256-gcm-v0' });
    const report = await insertEncryptedReport('TSH,2.1,mIU/L');
    await pool.query('UPDATE reports SET encryption_version = 0 WHERE id = $1', [report.id]);
    const result = await maintenance.reencryptFiles();
    assert.ok(result.reports.reencrypted >= 1);
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [report.id]);
    assert.equal(rows[0].encryption_version, CURRENT_VERSION);
    assert.notEqual(rows[0].storage_object_key, report.storage_object_key);
    assert.ok(!fs.existsSync(path.join(tempDir, report.storage_object_key)), 'old object removed');
    assert.equal((await store.readDecrypted(rows[0])).toString(), 'TSH,2.1,mIU/L');
  });

  await t.test('audit events are append-only', async () => {
    await pool.query(`INSERT INTO security_audit_events (user_id, event_type) VALUES ($1, 'REPORT_VIEWED')`, [dbUserId]);
    await assert.rejects(pool.query('UPDATE security_audit_events SET purpose = $2 WHERE user_id = $1', [dbUserId, 'x']), /append-only/);
    await assert.rejects(pool.query('DELETE FROM security_audit_events WHERE user_id = $1', [dbUserId]), /append-only/);
  });

  await t.test('key provider health check round-trips', async () => {
    const result = await maintenance.checkKeyProvider();
    assert.equal(result.provider, 'local-dev');
  });
});
