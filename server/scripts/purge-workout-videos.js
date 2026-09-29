// Hard-deletes retained workout recordings older than
// WORKOUT_VIDEO_RETENTION_DAYS (issue #135 Phase 3 retention policy). Does
// nothing while that setting is 0 (keep until the user deletes). Defaults to
// a dry run; pass --confirm to delete. Suitable for a daily cron.
//
// Usage:
//   node scripts/purge-workout-videos.js
//   node scripts/purge-workout-videos.js --confirm
require('dotenv').config();
const pool = require('../src/db/pool');
const config = require('../src/config');
const video = require('../src/services/workoutVideoService');

const confirm = process.argv.includes('--confirm');

(async () => {
  const days = config.workoutVideoRetentionDays;
  const expired = await video.findExpired(days);
  const summary = { retentionDays: days, matched: expired.length, deleted: 0, dryRun: !confirm };
  if (confirm) {
    for (const row of expired) {
      await video.hardDelete(row.user_id, row.workout_session_id, { reason: 'retention_policy' });
      summary.deleted += 1;
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exitCode = 1;
});
