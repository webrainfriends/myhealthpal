const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');

let userId;
let token;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('kitchen routes test') RETURNING id`);
  userId = user.rows[0].id;
  token = signSession({ id: userId });
});

test.after(async () => {
  await pool.query('DELETE FROM kitchen_items WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('kitchen item CRUD is authenticated, validated, and scoped to the caller', async () => {
  const { server, base } = await listen();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const unauthenticated = await fetch(`${base}/api/kitchen/items`);
    assert.equal(unauthenticated.status, 401);

    const badCategory = await fetch(`${base}/api/kitchen/items`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Onion', category: 'not-a-category' }),
    });
    assert.equal(badCategory.status, 400);

    const created = await fetch(`${base}/api/kitchen/items`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Onion', category: 'vegetable', quantity_amount: 3, quantity_unit: 'piece' }),
    });
    assert.equal(created.status, 201);
    const item = (await created.json()).item;
    assert.equal(item.name, 'Onion');

    const listed = await fetch(`${base}/api/kitchen/items`, { headers });
    assert.equal((await listed.json()).items.length, 1);

    const patched = await fetch(`${base}/api/kitchen/items/${item.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ is_available: false }),
    });
    assert.equal(patched.status, 200);

    const filteredAvailable = await fetch(`${base}/api/kitchen/items?available_only=true`, { headers });
    assert.equal((await filteredAvailable.json()).items.length, 0);

    const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other kitchen routes user') RETURNING id`);
    const otherToken = signSession({ id: other.rows[0].id });
    const crossUserPatch = await fetch(`${base}/api/kitchen/items/${item.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: true }),
    });
    assert.equal(crossUserPatch.status, 404);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);

    const deleted = await fetch(`${base}/api/kitchen/items/${item.id}`, { method: 'DELETE', headers });
    assert.equal(deleted.status, 204);

    const deletedAgain = await fetch(`${base}/api/kitchen/items/${item.id}`, { method: 'DELETE', headers });
    assert.equal(deletedAgain.status, 404);
  } finally {
    server.close();
  }
});
