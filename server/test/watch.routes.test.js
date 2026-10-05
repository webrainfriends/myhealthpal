const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');

let userId;
let phoneToken;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('watch routes test') RETURNING id`);
  userId = user.rows[0].id;
  phoneToken = signSession({ id: userId });
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

const json = (token) => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });

async function pairWatch(base, platform = 'watchos') {
  const start = await fetch(`${base}/api/watch/pair/start`, { method: 'POST', headers: json(), body: JSON.stringify({ deviceName: 'Test watch', platform }) });
  assert.equal(start.status, 201);
  const { pairingId, code, pollSecret } = await start.json();
  assert.match(code, /^\d{6}$/);

  const poll = (secret = pollSecret) => fetch(`${base}/api/watch/pair/poll`, { method: 'POST', headers: json(), body: JSON.stringify({ pairingId, pollSecret: secret }) }).then((r) => r.json());
  assert.equal((await poll()).status, 'pending');

  const confirm = await fetch(`${base}/api/watch/pair/confirm`, { method: 'POST', headers: json(phoneToken), body: JSON.stringify({ code }) });
  assert.equal(confirm.status, 200);
  const device = (await confirm.json()).device;

  const done = await poll();
  assert.equal(done.status, 'approved');
  assert.equal((await poll()).status, 'already_collected', 'the token is handed over only once');
  return { token: done.token, device, pairingId, poll };
}

test('pairing: start -> phone confirms -> watch collects a token once; bad input is rejected', async () => {
  const { server, base } = await listen();
  try {
    const badPlatform = await fetch(`${base}/api/watch/pair/start`, { method: 'POST', headers: json(), body: JSON.stringify({ platform: 'palmos' }) });
    assert.equal(badPlatform.status, 400);

    const noAuth = await fetch(`${base}/api/watch/pair/confirm`, { method: 'POST', headers: json(), body: JSON.stringify({ code: '123456' }) });
    assert.equal(noAuth.status, 401);

    const badFormat = await fetch(`${base}/api/watch/pair/confirm`, { method: 'POST', headers: json(phoneToken), body: JSON.stringify({ code: '12' }) });
    assert.equal(badFormat.status, 400);

    const unknown = await fetch(`${base}/api/watch/pair/confirm`, { method: 'POST', headers: json(phoneToken), body: JSON.stringify({ code: '000000' }) });
    assert.ok([404, 200].includes(unknown.status));

    const wrongSecret = await fetch(`${base}/api/watch/pair/poll`, { method: 'POST', headers: json(), body: JSON.stringify({ pairingId: '00000000-0000-0000-0000-000000000000', pollSecret: 'x' }) });
    assert.equal(wrongSecret.status, 404);

    const { device } = await pairWatch(base);
    assert.equal(device.deviceName, 'Test watch');
  } finally {
    server.close();
  }
});

test('a watch token reaches only the allow-listed routes, and cannot manage watches or family', async () => {
  const { server, base } = await listen();
  try {
    const { token } = await pairWatch(base, 'wearos');
    const h = json(token);

    assert.equal((await fetch(`${base}/api/water/summary`, { headers: h })).status, 200);
    assert.equal((await fetch(`${base}/api/medications/reminders/today`, { headers: h })).status, 200);
    assert.equal((await fetch(`${base}/api/health-profile/weight`, { method: 'POST', headers: h, body: JSON.stringify({ weightKg: 71.5 }) })).status, 201);

    for (const [method, path] of [['GET', '/api/reports'], ['GET', '/api/family'], ['GET', '/api/watch/devices'], ['GET', '/api/auth/me'], ['POST', '/api/diet/entries'], ['DELETE', '/api/water/entries/00000000-0000-0000-0000-000000000000']]) {
      const res = await fetch(`${base}${path}`, { method, headers: h, body: method === 'POST' ? '{}' : undefined });
      assert.ok([401, 403].includes(res.status), `${method} ${path} should be refused, got ${res.status}`);
    }

    // Phone-side routes still work for the phone's own token.
    const devices = await fetch(`${base}/api/watch/devices`, { headers: json(phoneToken) });
    assert.equal(devices.status, 200);
    assert.ok((await devices.json()).devices.length >= 1);
  } finally {
    server.close();
  }
});

test('removing a watch from the phone stops its token working immediately', async () => {
  const { server, base } = await listen();
  try {
    const { token, device } = await pairWatch(base);
    assert.equal((await fetch(`${base}/api/water/summary`, { headers: json(token) })).status, 200);

    const del = await fetch(`${base}/api/watch/devices/${device.id}`, { method: 'DELETE', headers: json(phoneToken) });
    assert.equal(del.status, 204);
    assert.equal((await fetch(`${base}/api/water/summary`, { headers: json(token) })).status, 401);
    assert.equal((await fetch(`${base}/api/watch/devices/${device.id}`, { method: 'DELETE', headers: json(phoneToken) })).status, 404);
  } finally {
    server.close();
  }
});

test('water: a retried log with the same client_entry_id is not counted twice', async () => {
  const { server, base } = await listen();
  try {
    const { token } = await pairWatch(base);
    const body = JSON.stringify({ amount_ml: 250, client_entry_id: 'watch-abc-1' });
    const first = await fetch(`${base}/api/water/entries`, { method: 'POST', headers: json(token), body });
    const retry = await fetch(`${base}/api/water/entries`, { method: 'POST', headers: json(token), body });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal((await first.json()).entry.id, (await retry.json()).entry.id);

    const summary = await (await fetch(`${base}/api/water/summary`, { headers: json(token) })).json();
    assert.equal(summary.totalMl, 250);

    // Without a key nothing changes: two logs are two entries.
    await fetch(`${base}/api/water/entries`, { method: 'POST', headers: json(token), body: JSON.stringify({ amount_ml: 100 }) });
    await fetch(`${base}/api/water/entries`, { method: 'POST', headers: json(token), body: JSON.stringify({ amount_ml: 100 }) });
    const after = await (await fetch(`${base}/api/water/summary`, { headers: json(token) })).json();
    assert.equal(after.totalMl, 450);
  } finally {
    server.close();
  }
});
