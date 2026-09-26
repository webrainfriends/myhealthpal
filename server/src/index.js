// pdfjs-dist (used for text-native PDF extraction, required transitively via
// ./app -> adapters/pdfAdapter.js) calls Promise.withResolvers, added in
// Node.js 22 - polyfill it so this still works on a host running an older
// Node (e.g. one bootstrapped with Node 20 for another app already sharing
// it), rather than depend on every dependency's Node-version floor matching
// whatever happens to be installed there. Must run before ./app is
// required, since that require chain loads pdfjs-dist eagerly.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const app = require('./app');
const config = require('./config');
const { backfillMisclassifiedActivityReports } = require('./services/activityBackfillService');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`EyeMyHealth API listening on port ${config.port}`);
});

// Fire-and-forget, after the server is already accepting requests - a
// backfill over however many legacy reports exist must never delay startup.
// See activityBackfillService.js for why this needs to run at all.
backfillMisclassifiedActivityReports().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Activity backfill failed to run:', err);
});

// Retest Radar reminders: checked hourly in-process (each reminder is
// recorded once sent, so re-running is harmless and a restart just picks up
// on the next tick). Set RETEST_REMINDERS=off to disable on a host that
// shouldn't send pushes, e.g. a local dev copy pointed at real data.
if (process.env.RETEST_REMINDERS !== 'off') {
  const { runReminders } = require('./retest/retestReminderService');
  const tick = () =>
    runReminders().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Retest reminder run failed:', err);
    });
  setInterval(tick, 60 * 60 * 1000).unref();
  tick();
}
