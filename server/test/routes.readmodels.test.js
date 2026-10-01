const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const authService = require('../src/services/authService');

// The REST routes whose read logic moved into shared services (also used by
// the MCP connector) must keep returning exactly the shapes the app expects.

let server;
let baseUrl;
let user;
let token;

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', 'RMT user') RETURNING *`);
  user = rows[0];
  token = authService.signSession(user);
  await pool.query(`INSERT INTO food_entries (user_id, name, meal_type, consumed_at, is_confirmed, calories) VALUES ($1, 'Rice', 'lunch', now(), true, 300)`, [user.id]);
  await pool.query(`INSERT INTO activity_logs (user_id, log_date, steps) VALUES ($1, CURRENT_DATE, 5000)`, [user.id]);
  await pool.query(`INSERT INTO glucose_readings (user_id, measured_at, value_mg_dl) VALUES ($1, now(), 120)`, [user.id]);
  await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
     VALUES ($1, 'rmt.csv', 'text/csv', 'csv', 1, '/tmp/x', 'Completed', CURRENT_DATE)`,
    [user.id]
  );
});

test.after(async () => {
  await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /api/timeline', async () => {
  const r = await get('/api/timeline');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.timeline.map((x) => x.original_filename), ['rmt.csv']);
  assert.equal((await get('/api/timeline?search=nomatch')).body.timeline.length, 0);
});

test('GET /api/glucose/summary', async () => {
  const r = await get('/api/glucose/summary?days=7');
  assert.equal(r.status, 200);
  assert.equal(r.body.readingCount, 1);
  assert.ok(r.body.thresholds);
});

test('GET /api/diet/entries and /api/diet/summary', async () => {
  const entries = await get('/api/diet/entries');
  assert.equal(entries.status, 200);
  assert.deepEqual(entries.body.entries.map((e) => e.name), ['Rice']);
  const summary = await get('/api/diet/summary?days=2');
  assert.equal(summary.body.history.length, 2);
  assert.equal(summary.body.today.calories, 300);
  assert.equal(summary.body.pendingReviewCount, 0);
});

test('GET /api/activity/summary keeps its shape', async () => {
  const r = await get('/api/activity/summary?days=3');
  assert.equal(r.status, 200);
  assert.equal(r.body.goals.steps, 10000);
  assert.equal(r.body.today.steps, 5000);
  assert.equal(r.body.history.length, 3);
  assert.equal(r.body.isCurrentToday, true);
});

test('GET /api/dashboard/snapshot and /organs keep their shape', async () => {
  const snap = await get('/api/dashboard/snapshot');
  assert.equal(snap.status, 200);
  assert.ok(Array.isArray(snap.body.trackedMetrics) && Array.isArray(snap.body.needsAttention) && Array.isArray(snap.body.insights));
  const organs = await get('/api/dashboard/organs');
  assert.equal(organs.status, 200);
  assert.ok(Array.isArray(organs.body.organs) && organs.body.organs.length > 0);
});
