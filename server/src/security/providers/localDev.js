const crypto = require('crypto');

// Development/test-only key provider. Wraps each DEK with AES-256-GCM under
// a master key supplied at runtime (LOCAL_DEV_MASTER_KEY, 64 hex chars) -
// never from Git. It refuses to exist in production: a master key sitting
// in the app's own environment defeats the point of external key
// management (a server compromise would expose both the files and the key).
const WRAP_VERSION = 1;

function createLocalDevProvider({ masterKeyHex, nodeEnv, keyVersion = 'local-dev-v1' } = {}) {
  if (nodeEnv === 'production') {
    throw new Error('KEY_PROVIDER=local-dev is not allowed in production. Configure KEY_PROVIDER=aws-kms.');
  }
  if (!masterKeyHex || !/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
    throw new Error('LOCAL_DEV_MASTER_KEY must be 64 hex characters. Generate with `openssl rand -hex 32`.');
  }
  const masterKey = Buffer.from(masterKeyHex, 'hex');

  function aad(ctx) {
    return Buffer.from(`myhealthpal|${ctx.userId}|${ctx.objectKey}`, 'utf8');
  }

  function wrap(plaintextKey, ctx) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    cipher.setAAD(aad(ctx));
    const body = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return Buffer.concat([Buffer.from([WRAP_VERSION]), iv, cipher.getAuthTag(), body]);
  }

  function unwrap(wrappedKey, ctx) {
    if (wrappedKey[0] !== WRAP_VERSION) throw new Error('Unknown wrapped-key format');
    const iv = wrappedKey.subarray(1, 13);
    const tag = wrappedKey.subarray(13, 29);
    const body = wrappedKey.subarray(29);
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAAD(aad(ctx));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  return {
    name: 'local-dev',

    async generateDataKey(ctx) {
      const plaintextKey = crypto.randomBytes(32);
      return { plaintextKey, wrappedKey: wrap(plaintextKey, ctx), keyReference: 'local-dev', keyVersion };
    },

    async unwrapDataKey(wrappedKey, keyReference, ctx) {
      return unwrap(wrappedKey, ctx);
    },

    async rewrapDataKey(wrappedKey, keyReference, ctx) {
      const plaintextKey = unwrap(wrappedKey, ctx);
      try {
        return { wrappedKey: wrap(plaintextKey, ctx), keyReference: 'local-dev', keyVersion };
      } finally {
        plaintextKey.fill(0);
      }
    },

    async currentKeyReference() {
      return keyVersion;
    },
  };
}

module.exports = { createLocalDevProvider };
