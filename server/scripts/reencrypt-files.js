// Re-encrypts files written with an older encryption_version under the current one. --dry-run prints counts only.
// Usage: node scripts/reencrypt-files.js [--dry-run]
// Output is counts per table only - never filenames, paths or contents.
require('dotenv').config();
const pool = require('../src/db/pool');
const { reencryptFiles } = require('../src/security/maintenance');

reencryptFiles({ dryRun: process.argv.includes('--dry-run') })
  .then((summary) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    const failed = Object.values(summary).some((t) => t && t.failed > 0);
    if (failed) process.exitCode = 2;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`reencrypt-files failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
