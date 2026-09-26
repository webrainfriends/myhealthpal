const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getKeyProvider } = require('./keyProvider');
const { CURRENT_VERSION, getVersion } = require('./cipherVersions');
const metrics = require('./metrics');

// Envelope encryption for medical files (issue #104):
//  - a fresh random 256-bit data key (DEK) per file, from the key provider;
//  - AES-256-GCM with a fresh random 96-bit IV per encryption;
//  - only ciphertext is written, under an opaque random object key (never
//    the user's filename), owner-only permissions, via temp-file + rename;
//  - the database keeps only the wrapped DEK and the metadata needed to
//    decrypt and rotate; the plaintext DEK is zeroed after use.
// Reads verify the ciphertext checksum and the GCM tag before returning a
// single byte, and every failure throws - there is no plaintext fallback.

function storeDir() {
  return config.security.encryptedStoreDir;
}

function ensureStoreDir() {
  fs.mkdirSync(storeDir(), { recursive: true, mode: 0o700 });
}

function objectPath(objectKey) {
  if (!/^[0-9a-f-]{36}$/.test(objectKey)) throw new Error('Invalid storage object key');
  return path.join(storeDir(), objectKey);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function put({ userId, buffer }) {
  if (!userId) throw new Error('userId is required to encrypt a file');
  const started = Date.now();
  ensureStoreDir();
  const objectKey = crypto.randomUUID();
  const ctx = { userId, objectKey };
  const provider = getKeyProvider();
  const { plaintextKey, wrappedKey, keyReference, keyVersion } = await provider.generateDataKey(ctx);
  try {
    const scheme = getVersion(CURRENT_VERSION);
    const { ciphertext, iv, authTag } = scheme.encrypt(plaintextKey, buffer, ctx);
    const finalPath = objectPath(objectKey);
    const tempPath = `${finalPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    await fs.promises.writeFile(tempPath, ciphertext, { mode: 0o600, flag: 'wx' });
    await fs.promises.rename(tempPath, finalPath);
    metrics.record('encrypt', Date.now() - started);
    return {
      encryptionVersion: CURRENT_VERSION,
      cipherAlgorithm: scheme.algorithm,
      storageObjectKey: objectKey,
      encryptedDataKey: wrappedKey,
      keyProvider: provider.name,
      keyReference,
      keyVersion,
      cipherIv: iv,
      cipherAuthTag: authTag,
      ciphertextSha256: sha256(ciphertext),
    };
  } catch (err) {
    metrics.increment('encrypt_failure');
    throw err;
  } finally {
    plaintextKey.fill(0);
  }
}

// `meta` is either put()'s return value or a DB row (snake_case columns).
function normalize(meta, userId) {
  const m = meta.storageObjectKey ? meta : fromRow(meta);
  return { ...m, userId: userId || meta.user_id || meta.userId };
}

async function readDecrypted(meta, { userId } = {}) {
  const m = normalize(meta, userId);
  if (!m.storageObjectKey || m.encryptionVersion == null) throw new Error('File is not in the encrypted store');
  const started = Date.now();
  const ciphertext = await fs.promises.readFile(objectPath(m.storageObjectKey));
  if (m.ciphertextSha256 && sha256(ciphertext) !== m.ciphertextSha256) {
    metrics.increment('decrypt_failure');
    throw new Error('Encrypted file failed its integrity check');
  }
  const ctx = { userId: m.userId, objectKey: m.storageObjectKey };
  let key;
  try {
    key = await getKeyProvider().unwrapDataKey(m.encryptedDataKey, m.keyReference, ctx);
    const plaintext = getVersion(m.encryptionVersion).decrypt(
      key,
      { ciphertext, iv: m.cipherIv, authTag: m.cipherAuthTag },
      ctx
    );
    metrics.record('decrypt', Date.now() - started);
    return plaintext;
  } catch (err) {
    metrics.increment('decrypt_failure');
    throw new Error(`Encrypted file could not be decrypted (${err.name || 'Error'})`);
  } finally {
    if (key) key.fill(0);
  }
}

async function remove(meta) {
  const m = meta.storageObjectKey ? meta : fromRow(meta);
  if (!m.storageObjectKey) return;
  await fs.promises.unlink(objectPath(m.storageObjectKey)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

// Column mapping shared by every table that stores an encrypted file
// (reports, medication_scans, diet_scans).
const COLUMNS = [
  ['encryption_version', 'encryptionVersion'],
  ['cipher_algorithm', 'cipherAlgorithm'],
  ['storage_object_key', 'storageObjectKey'],
  ['encrypted_data_key', 'encryptedDataKey'],
  ['key_provider', 'keyProvider'],
  ['key_reference', 'keyReference'],
  ['key_version', 'keyVersion'],
  ['cipher_iv', 'cipherIv'],
  ['cipher_auth_tag', 'cipherAuthTag'],
  ['ciphertext_sha256', 'ciphertextSha256'],
];

function fromRow(row) {
  const m = {};
  for (const [col, prop] of COLUMNS) m[prop] = row[col] ?? null;
  return m;
}

function toColumns(meta) {
  return COLUMNS.map(([col, prop]) => [col, meta[prop]]);
}

module.exports = { put, readDecrypted, remove, fromRow, toColumns, COLUMNS, ensureStoreDir };
