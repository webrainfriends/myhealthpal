const config = require('../config');
const { createAwsKmsProvider } = require('./providers/awsKms');
const { createLocalDevProvider } = require('./providers/localDev');

// Provider-neutral key management. Routes and services only ever see this
// interface ({ generateDataKey, unwrapDataKey, rewrapDataKey,
// currentKeyReference }), so swapping AWS KMS for Azure Key Vault / Google
// Cloud KMS / an HSM means adding one provider file here.
let cached = null;

function createKeyProvider(options = config.security) {
  switch (options.keyProvider) {
    case 'aws-kms':
      return createAwsKmsProvider({ keyId: options.kmsKeyId, region: options.kmsRegion });
    case 'local-dev': {
      const provider = createLocalDevProvider({ masterKeyHex: options.localDevMasterKey, nodeEnv: config.nodeEnv });
      // eslint-disable-next-line no-console
      console.warn('[security] KEY_PROVIDER=local-dev - development/test only, never use in production.');
      return provider;
    }
    default:
      throw new Error(
        `KEY_PROVIDER is ${options.keyProvider ? `"${options.keyProvider}"` : 'not set'}. ` +
          'Set KEY_PROVIDER=aws-kms (production) or KEY_PROVIDER=local-dev (development only).'
      );
  }
}

function getKeyProvider() {
  if (!cached) cached = createKeyProvider();
  return cached;
}

// Tests and scripts can inject a provider (e.g. a fresh local-dev one).
function setKeyProvider(provider) {
  cached = provider;
}

module.exports = { getKeyProvider, setKeyProvider, createKeyProvider };
