const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Encrypts a secret (a Gmail OAuth refresh token, specifically) for storage
// at rest. Output packs iv || authTag || ciphertext into one base64 string
// so callers never juggle three separate columns.
function encryptSecret(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, config.gmailTokenEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// Throws (rather than returning a partial/garbage result) if the key has
// changed since encryption (e.g. an ephemeral dev key regenerated on
// restart) or the payload was tampered with - callers must treat that as
// "this connection needs to be reauthorized", never silently proceed with a
// wrong token.
function decryptSecret(payload) {
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, config.gmailTokenEncryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
