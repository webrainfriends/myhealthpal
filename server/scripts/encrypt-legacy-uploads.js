// Encrypts legacy plaintext uploads in place (verify-then-delete). --dry-run prints counts only.
// Usage: node scripts/encrypt-legacy-uploads.js [--dry-run]
// Output is counts per table only - never filenames, paths or contents.
require('dotenv').config();
const pool = require('../src/db/pool');
const { encryptLegacyUploads } = require('../src/security/maintenance');

encryptLegacyUploads({ dryRun: process.argv.includes('--dry-run') })
  .then((summary) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
    const failed = Object.values(summary).some((t) => t && t.failed > 0);
    if (failed) process.exitCode = 2;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`encrypt-legacy-uploads failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
