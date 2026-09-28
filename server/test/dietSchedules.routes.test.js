const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');

let userId;
let token;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('diet schedules routes test') RETURNING id`);
  userId = user.rows[0].id;
  token = signSession({ id: userId });
});

test.after(async () => {
  await pool.query('DELETE FROM schedule_impact_flags WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedule_entries WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedules WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('POST /api/diet-schedules validates duration/entries and creates a schedule with computed dates', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const unauthenticated = await fetch(`${base}/api/diet-schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauthenticated.status, 401);

    const badDuration = await fetch(`${base}/api/diet-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'Bad', duration_days: 10, start_date: '2026-04-01', entries: [{ day_number: 1, meal_type: 'breakfast', dish_name: 'Oats' }] }),
    });
    assert.equal(badDuration.status, 400);

    const created = await fetch(`${base}/api/diet-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'My Week', duration_days: 7, start_date: '2026-04-01',
        entries: [
          { day_number: 1, meal_type: 'breakfast', dish_name: 'Idli sambar' },
          { day_number: 7, meal_type: 'dinner', dish_name: 'Vegetable pulao' },
        ],
      }),
    });
    assert.equal(created.status, 201);
    const schedule = (await created.json()).schedule;
    assert.equal(schedule.duration_days, 7);
    assert.equal(schedule.entries.length, 2);

    const listed = await fetch(`${base}/api/diet-schedules`, { headers });
    assert.ok((await listed.json()).schedules.some((s) => s.id === schedule.id));

    const fetched = await fetch(`${base}/api/diet-schedules/${schedule.id}`, { headers });
    assert.equal(fetched.status, 200);

    return schedule;
  } finally {
    server.close();
  }
});

test('a schedule and its entries are never visible or editable by another user', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const created = await fetch(`${base}/api/diet-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'Private Week', duration_days: 7, start_date: '2026-04-01', entries: [{ day_number: 1, meal_type: 'lunch', dish_name: 'Dal' }] }),
    });
    const schedule = (await created.json()).schedule;
    const entryId = schedule.entries[0].id;

    const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other schedules routes user') RETURNING id`);
    const otherToken = signSession({ id: other.rows[0].id });
    const otherHeaders = { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };

    try {
      const crossGet = await fetch(`${base}/api/diet-schedules/${schedule.id}`, { headers: otherHeaders });
      assert.equal(crossGet.status, 404);

      const crossPatch = await fetch(`${base}/api/diet-schedules/entries/${entryId}`, { method: 'PATCH', headers: otherHeaders, body: JSON.stringify({ dish_name: 'Hacked' }) });
      assert.equal(crossPatch.status, 404);

      const crossDelete = await fetch(`${base}/api/diet-schedules/${schedule.id}`, { method: 'DELETE', headers: otherHeaders });
      assert.equal(crossDelete.status, 404);

      const stillMine = await fetch(`${base}/api/diet-schedules/${schedule.id}`, { headers });
      assert.equal(stillMine.status, 200);
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
    }
  } finally {
    server.close();
  }
});

test('PATCH an entry dish name validates and resets its recipe; GET impact works on a schedule with no recipes yet', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const created = await fetch(`${base}/api/diet-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'Edit Week', duration_days: 7, start_date: '2026-04-01', entries: [{ day_number: 2, meal_type: 'lunch', dish_name: 'Original' }] }),
    });
    const schedule = (await created.json()).schedule;
    const entryId = schedule.entries[0].id;

    const badMealType = await fetch(`${base}/api/diet-schedules/entries/${entryId}`, { method: 'PATCH', headers, body: JSON.stringify({ meal_type: 'brunch' }) });
    assert.equal(badMealType.status, 400);

    const patched = await fetch(`${base}/api/diet-schedules/entries/${entryId}`, { method: 'PATCH', headers, body: JSON.stringify({ dish_name: 'Updated Dish' }) });
    assert.equal(patched.status, 200);
    const entry = (await patched.json()).entry;
    assert.equal(entry.dishName, 'Updated Dish');
    assert.equal(entry.recipe, null);

    const impact = await fetch(`${base}/api/diet-schedules/${schedule.id}/impact`, { headers });
    assert.equal(impact.status, 200);
    const body = await impact.json();
    assert.deepEqual(body.impact.worsens, []);
    assert.deepEqual(body.impact.improves, []);

    const notFound = await fetch(`${base}/api/diet-schedules/00000000-0000-0000-0000-000000000000/impact`, { headers });
    assert.equal(notFound.status, 404);
  } finally {
    server.close();
  }
});

test('POST /api/diet-schedules/generate returns quickly with pending entries instead of blocking on AI generation (regression: 504 on the old synchronous path)', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const start = Date.now();
    const res = await fetch(`${base}/api/diet-schedules/generate`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: 'Kitchen Week', duration_days: 7, start_date: '2026-04-01',
        kitchen_item_ids: [], meal_types_per_day: ['breakfast', 'lunch'],
      }),
    });
    const elapsedMs = Date.now() - start;
    assert.equal(res.status, 201);
    assert.ok(elapsedMs < 2000, `expected a fast response, took ${elapsedMs}ms`);

    const body = await res.json();
    assert.equal(body.schedule.source_type, 'kitchen_generated');
    assert.equal(body.schedule.entries.length, 14); // 7 days * 2 meals
    assert.ok(body.schedule.entries.every((e) => ['pending', 'generating', 'failed'].includes(e.recipeStatus)));
  } finally {
    server.close();
  }
});

test('logging an entry with no generated recipe yet returns 404, and retry-recipe re-queues a failed entry', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    const created = await fetch(`${base}/api/diet-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'Log Week', duration_days: 7, start_date: '2026-04-01', entries: [{ day_number: 1, meal_type: 'breakfast', dish_name: 'Poha' }] }),
    });
    const schedule = (await created.json()).schedule;
    const entryId = schedule.entries[0].id;

    const logAttempt = await fetch(`${base}/api/diet-schedules/entries/${entryId}/log`, { method: 'POST', headers, body: '{}' });
    assert.equal(logAttempt.status, 404);

    const retry = await fetch(`${base}/api/diet-schedules/entries/${entryId}/retry-recipe`, { method: 'POST', headers });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).status, 'queued');

    const missingEntryRetry = await fetch(`${base}/api/diet-schedules/entries/00000000-0000-0000-0000-000000000000/retry-recipe`, { method: 'POST', headers });
    assert.equal(missingEntryRetry.status, 404);
  } finally {
    server.close();
  }
});
