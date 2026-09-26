const crypto = require('crypto');

// Every stored file records its encryption_version, so a future scheme can
// be introduced alongside this one and old files migrated in the
// background (scripts/reencrypt-files.js) rather than all at once.
// CURRENT_VERSION is what new files are written with.
const VERSIONS = {
  1: {
    algorithm: 'aes-256-gcm',
    ivBytes: 12,
    // The authenticated data binds ciphertext to its owner and object, so a
    // ciphertext file swapped onto another row fails to decrypt.
    aad: ({ userId, objectKey }) => Buffer.from(`myhealthpal:v1:${userId}:${objectKey}`, 'utf8'),
    encrypt(key, plaintext, ctx) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(this.aad(ctx));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ciphertext, iv, authTag: cipher.getAuthTag() };
    },
    decrypt(key, { ciphertext, iv, authTag }, ctx) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(this.aad(ctx));
      decipher.setAuthTag(authTag);
      // final() throws on any tag mismatch - tampered data never returns.
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    },
  },
};

const CURRENT_VERSION = 1;

function getVersion(version) {
  const scheme = VERSIONS[version];
  if (!scheme) throw new Error(`Unsupported encryption_version ${version}`);
  return scheme;
}

// Test/migration hook: register a new scheme (e.g. a stub v2 in tests).
function registerVersion(version, scheme) {
  VERSIONS[version] = scheme;
}

module.exports = { CURRENT_VERSION, getVersion, registerVersion };
