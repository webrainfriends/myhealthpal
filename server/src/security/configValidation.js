const fs = require('fs');
const config = require('../config');

// Refuses to start a production server whose medical-file protection
// isn't fully configured (issue #104 §11) - there is no degraded mode that
// stores reports without external key management. Returns the list of
// problems (empty when valid) so scripts can report them too.
function validateSecurityConfig(cfg = config) {
  const problems = [];
  const s = cfg.security;
  const production = cfg.nodeEnv === 'production';

  if (production) {
    if (s.keyProvider !== 'aws-kms') {
      problems.push(`KEY_PROVIDER must be "aws-kms" in production (got ${s.keyProvider ? `"${s.keyProvider}"` : 'nothing'}).`);
    }
    if (!s.kmsKeyId) problems.push('KMS_KEY_ID is required in production (the KMS key ARN, id or alias).');
    if (s.localDevMasterKey) problems.push('LOCAL_DEV_MASTER_KEY must not be set in production.');
    if (!process.env.ENCRYPTED_STORE_DIR) problems.push('ENCRYPTED_STORE_DIR must be set explicitly in production.');
    if (!process.env.JWT_SECRET) problems.push('JWT_SECRET must be set in production.');
  } else if (!s.keyProvider) {
    problems.push('KEY_PROVIDER is not set. For local development use KEY_PROVIDER=local-dev with LOCAL_DEV_MASTER_KEY (openssl rand -hex 32).');
  } else if (s.keyProvider === 'local-dev' && !/^[0-9a-f]{64}$/i.test(s.localDevMasterKey || '')) {
    problems.push('LOCAL_DEV_MASTER_KEY must be 64 hex characters (openssl rand -hex 32).');
  }

  if (!['aws-kms', 'local-dev', null].includes(s.keyProvider)) problems.push(`Unknown KEY_PROVIDER "${s.keyProvider}".`);
  if (!Number.isInteger(s.downloadTokenTtlSeconds) || s.downloadTokenTtlSeconds < 30 || s.downloadTokenTtlSeconds > 3600) {
    problems.push('DOWNLOAD_TOKEN_TTL_SECONDS must be between 30 and 3600.');
  }
  if (!['none', 'clamd'].includes(s.malwareScanner)) problems.push(`Unknown MALWARE_SCANNER "${s.malwareScanner}".`);
  if (production && s.legacyPlaintextReads === 'allow') {
    problems.push('LEGACY_PLAINTEXT_READS=allow is not permitted in production; run scripts/encrypt-legacy-uploads.js.');
  }

  try {
    fs.mkdirSync(s.encryptedStoreDir, { recursive: true, mode: 0o700 });
    fs.accessSync(s.encryptedStoreDir, fs.constants.W_OK | fs.constants.R_OK);
  } catch (err) {
    problems.push(`ENCRYPTED_STORE_DIR (${s.encryptedStoreDir}) is not a writable directory.`);
  }
  return problems;
}

function assertSecurityConfig() {
  const problems = validateSecurityConfig();
  if (problems.length === 0) return;
  const message = `Security configuration invalid:\n - ${problems.join('\n - ')}\nSee docs/security/key-management.md.`;
  if (config.nodeEnv === 'production') {
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  }
  // Development: warn loudly; uploads fail closed until it's fixed.
  // eslint-disable-next-line no-console
  console.warn(message);
}

module.exports = { validateSecurityConfig, assertSecurityConfig };
