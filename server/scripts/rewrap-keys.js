// Re-wraps every file's data key under the current KMS key (after changing KMS_KEY_ID). --dry-run prints counts only.
// Usage: node scripts/rewrap-keys.js [--dry-run]
// Output is counts per table only - never filenames, paths or contents.
require('dotenv').config();
const pool = require('../src/db/pool');
const { rewrapKeys } = require('../src/security/maintenance');

rewrapKeys({ dryRun: process.argv.includes('--dry-run') })
  .then((summary) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    const failed = Object.values(summary).some((t) => t && t.failed > 0);
    if (failed) process.exitCode = 2;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`rewrap-keys failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
