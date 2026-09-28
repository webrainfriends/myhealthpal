// Permanently deletes guest accounts (auth_provider = 'guest') created
// before a cutoff date, freeing their slot in the closed-beta user cap.
// Defaults to a dry run (prints how many accounts match, deletes nothing);
// pass --confirm to actually delete. Does NOT delete managed family
// profiles a matched guest created - see maintenance.deleteStaleGuestAccounts.
//
// Usage:
//   node scripts/delete-stale-guests.js --before=2026-09-27
//   node scripts/delete-stale-guests.js --before=2026-09-27 --confirm
require('dotenv').config();
const pool = require('../src/db/pool');
const { deleteStaleGuestAccounts } = require('../src/security/maintenance');

const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const before = beforeArg ? beforeArg.slice('--before='.length) : null;
const confirm = process.argv.includes('--confirm');

if (!before) {
  // eslint-disable-next-line no-console
  console.error('Usage: node scripts/delete-stale-guests.js --before=YYYY-MM-DD [--confirm]');
  process.exitCode = 1;
} else {
  deleteStaleGuestAccounts({ before, dryRun: !confirm })
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(summary, null, 2));
      if (!confirm && summary.matched > 0) {
        // eslint-disable-next-line no-console
        console.log(`\nDry run only - re-run with --confirm to actually delete these ${summary.matched} account(s).`);
      }
      if (summary.filesFailed > 0) process.exitCode = 2;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`delete-stale-guests failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
