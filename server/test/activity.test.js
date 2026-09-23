const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { normalizeDate } = require('../src/routes/activity');

// Regression test for a real production bug: db/pool.js sets a global type
// parser so a DATE column (activity_logs.log_date included) comes back from
// `pg` as a plain 'YYYY-MM-DD' string, not a JS Date - but GET /summary's
// grouping step called `row.log_date.toISOString()` directly, which throws
// "row.log_date.toISOString is not a function" the instant a real
// activity_logs row is fetched, turning the whole endpoint into a 500 (and,
// per the dashboard's Promise.allSettled handling, silently dropping the
// Activity card with no visible error). This suite proves both halves: the
// driver really does hand back a string for this column, and normalizeDate
// (what GET /summary now uses instead of a bare .toISOString() call)
// handles that shape - and a real Date, for good measure - without throwing.

let userId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('activity-route-test@example.com', 'Activity Route Test') RETURNING id`
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO activity_logs (user_id, log_date, steps) VALUES ($1, '2026-03-01', 4000)`,
    [userId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('the pg driver returns activity_logs.log_date as a plain string, not a Date', async () => {
  const { rows } = await pool.query('SELECT log_date FROM activity_logs WHERE user_id = $1', [userId]);
  assert.equal(typeof rows[0].log_date, 'string');
  assert.equal(rows[0].log_date, '2026-03-01');
});

test('normalizeDate handles the real string shape a DATE column comes back as', () => {
  assert.equal(normalizeDate('2026-03-01'), '2026-03-01');
});

test('normalizeDate still handles a real Date object (e.g. from a driver/config change)', () => {
  assert.equal(normalizeDate(new Date('2026-03-01T00:00:00.000Z')), '2026-03-01');
});

test('normalizeDate returns null for a missing date', () => {
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(undefined), null);
});
