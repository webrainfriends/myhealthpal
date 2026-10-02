// Re-normalizes results saved before the unit / alias / matching fixes so the
// dashboard cards and lists show the corrected values. No AI calls; raw
// extracted fields are never changed; hand-corrected results are skipped.
// Safe to run repeatedly. Defaults to a dry run (prints counts, writes
// nothing); pass --confirm to apply. Prints counts only (no health data).
//
// Usage:
//   node scripts/renormalize-measurements.js            # dry run
//   node scripts/renormalize-measurements.js --confirm  # apply
require('dotenv').config();
const pool = require('../src/db/pool');
const { renormalize } = require('../src/services/renormalizeService');

const confirm = process.argv.includes('--confirm');

renormalize({ dryRun: !confirm, log: (m) => console.warn(m) })
  .then((stats) => {
    console.log(JSON.stringify(stats, null, 2));
    if (!confirm && stats.changed > 0) {
      console.log(`\nDry run only - re-run with --confirm to update these ${stats.changed} result(s).`);
    }
  })
  .catch((err) => {
    console.error('renormalize failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
