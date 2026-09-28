const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');

let userId;
let token;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('water routes test') RETURNING id`);
  userId = user.rows[0].id;
  token = signSession({ id: userId });
});

test.after(async () => {
  await pool.query('DELETE FROM water_entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM water_targets WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /api/water/summary requires auth and returns a target + deterministic alert for an empty day', async () => {
  const { server, base } = await listen();
  try {
    const unauthenticated = await fetch(`${base}/api/water/summary`);
    assert.equal(unauthenticated.status, 401);

    const res = await fetch(`${base}/api/water/summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalMl, 0);
    assert.equal(body.alert.status, 'under');
    assert.ok(body.target.min_ml > 0 && body.target.max_ml > body.target.min_ml);
    assert.equal(typeof body.remindersEnabled, 'boolean');
  } finally {
    server.close();
  }
});

test('POST /api/water/entries validates amount, logs it, and it is reflected in the summary total scoped to the caller', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const badAmount = await fetch(`${base}/api/water/entries`, { method: 'POST', headers, body: JSON.stringify({ amount_ml: 10000 }) });
    assert.equal(badAmount.status, 400);

    const logged = await fetch(`${base}/api/water/entries`, { method: 'POST', headers, body: JSON.stringify({ amount_ml: 500 }) });
    assert.equal(logged.status, 201);
    const entry = (await logged.json()).entry;
    assert.equal(entry.amount_ml, 500);

    const summary = await fetch(`${base}/api/water/summary`, { headers });
    const body = await summary.json();
    assert.ok(body.entries.some((e) => e.id === entry.id));

    const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other water routes user') RETURNING id`);
    const otherToken = signSession({ id: other.rows[0].id });
    const crossUserSummary = await fetch(`${base}/api/water/summary`, { headers: { Authorization: `Bearer ${otherToken}` } });
    const crossBody = await crossUserSummary.json();
    assert.ok(!crossBody.entries.some((e) => e.id === entry.id));

    const crossDelete = await fetch(`${base}/api/water/entries/${entry.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherToken}` } });
    assert.equal(crossDelete.status, 404);

    const ownDelete = await fetch(`${base}/api/water/entries/${entry.id}`, { method: 'DELETE', headers });
    assert.equal(ownDelete.status, 204);

    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  } finally {
    server.close();
  }
});

test('PUT /api/account/water-settings validates and persists the reminder toggle, reflected in the water summary', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const badBody = await fetch(`${base}/api/account/water-settings`, { method: 'PUT', headers, body: JSON.stringify({ remindersEnabled: 'yes' }) });
    assert.equal(badBody.status, 400);

    const off = await fetch(`${base}/api/account/water-settings`, { method: 'PUT', headers, body: JSON.stringify({ remindersEnabled: false }) });
    assert.equal(off.status, 200);

    const summary = await fetch(`${base}/api/water/summary`, { headers });
    assert.equal((await summary.json()).remindersEnabled, false);

    await fetch(`${base}/api/account/water-settings`, { method: 'PUT', headers, body: JSON.stringify({ remindersEnabled: true }) });
  } finally {
    server.close();
  }
});

test('POST /api/water/target/refresh recomputes even when the cached target is not stale', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const first = await fetch(`${base}/api/water/target`, { headers });
    const firstTarget = (await first.json()).target;

    const refreshed = await fetch(`${base}/api/water/target/refresh`, { method: 'POST', headers });
    assert.equal(refreshed.status, 200);
    const refreshedTarget = (await refreshed.json()).target;
    assert.notEqual(new Date(refreshedTarget.generated_at).getTime(), 0);
    assert.equal(refreshedTarget.user_id, firstTarget.user_id);
  } finally {
    server.close();
  }
});
