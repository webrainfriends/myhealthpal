// Verifies this machine can use the configured key provider (AWS KMS in
// production) by round-tripping a data key. deploy.yml runs it before
// restarting the app, so a missing KMS key/IAM role fails the deploy while
// the previous version keeps running.
require('dotenv').config();
const { validateSecurityConfig } = require('../src/security/configValidation');
const { checkKeyProvider } = require('../src/security/maintenance');

const problems = validateSecurityConfig();
if (problems.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`Security configuration invalid:\n - ${problems.join('\n - ')}\nSee docs/security/key-management.md.`);
  process.exit(1);
}

checkKeyProvider()
  .then(({ provider }) => {
    // eslint-disable-next-line no-console
    console.log(`Key provider OK (${provider}).`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      `Key provider check FAILED: ${err.name}: ${err.message}\n` +
        'Check that KMS_KEY_ID is correct and that the EC2 instance role allows kms:GenerateDataKey, kms:Decrypt, ' +
        'kms:ReEncrypt* and kms:DescribeKey on it. See docs/security/key-management.md.'
    );
    process.exit(1);
  });
