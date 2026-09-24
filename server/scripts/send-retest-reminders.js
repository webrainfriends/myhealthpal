// Runs one Retest Radar reminder pass immediately, ignoring the daytime send
// window - for testing pushes end-to-end (`npm run retest-reminders`). The
// API process already runs this hourly on its own.
require('dotenv').config();
const pool = require('../src/db/pool');
const { runReminders } = require('../src/retest/retestReminderService');

runReminders({ ignoreSendWindow: true })
  .then(({ sent }) => {
    // eslint-disable-next-line no-console
    console.log(`Sent ${sent} reminder notification(s).`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
