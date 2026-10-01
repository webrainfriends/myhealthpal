const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const authService = require('../src/services/authService');

// REST routes whose write logic now lives in shared services (also called by
// the MCP connector): same status codes, same messages, same effects.

let server;
let baseUrl;
let user;
let other;
let token;
const ids = {};

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  user = (await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', 'RAT user') RETURNING *`)).rows[0];
  other = (await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', 'RAT other') RETURNING *`)).rows[0];
  token = authService.signSession(user);

  const param = (await pool.query(`SELECT id FROM health_parameters LIMIT 1`)).rows[0];
  ids.retest = (await pool.query(
    `INSERT INTO retest_plans (user_id, health_parameter_id, reason, due_date) VALUES ($1, $2, 'abnormal_recheck', CURRENT_DATE + 30) RETURNING id`,
    [user.id, param.id]
  )).rows[0].id;
  ids.insight = (await pool.query(
    `INSERT INTO insights (user_id, insight_type, title, explanation, evidence, dedup_key) VALUES ($1, 'new_result', 'T', 'E', '[]', 'rat-1') RETURNING id`,
    [user.id]
  )).rows[0].id;
  ids.med = (await pool.query(
    `INSERT INTO medications (user_id, name, status, is_confirmed, times_of_day, total_doses) VALUES ($1, 'RatMed', 'active', true, ARRAY['morning','evening'], 4) RETURNING id`,
    [user.id]
  )).rows[0].id;
  ids.otherMed = (await pool.query(
    `INSERT INTO medications (user_id, name, status, is_confirmed, times_of_day, total_doses) VALUES ($1, 'OtherMed', 'active', true, ARRAY['morning'], 4) RETURNING id`,
    [other.id]
  )).rows[0].id;
  ids.alert = (await pool.query(
    `INSERT INTO medication_alerts (user_id, medication_id, alert_type, title, message, dedup_key) VALUES ($1, $2, 'refill_needed', 'T', 'M', 'rat-a') RETURNING id`,
    [user.id, ids.med]
  )).rows[0].id;
});

test.after(async () => {
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'RAT %'`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('retest: snooze validates days, dismiss and checkin work, other users\' plans are 404', async () => {
  assert.equal((await call('POST', `/api/retest/${ids.retest}/snooze`, { days: 0 })).status, 400);
  assert.equal((await call('POST', `/api/retest/${ids.retest}/snooze`, { days: 61 })).status, 400);
  const snoozed = await call('POST', `/api/retest/${ids.retest}/snooze`, { days: 14 });
  assert.equal(snoozed.status, 200);
  assert.equal(snoozed.body.plan.status, 'snoozed');
  const checkin = await call('POST', `/api/retest/${ids.retest}/checkin`, { done: true });
  assert.equal(checkin.status, 200);
  assert.equal((await call('POST', '/api/retest/00000000-0000-0000-0000-000000000000/checkin', { done: true })).status, 404);
  const dismissed = await call('POST', `/api/retest/${ids.retest}/dismiss`);
  assert.equal(dismissed.body.plan.status, 'dismissed');
  assert.equal((await call('POST', `/api/retest/${ids.retest}/dismiss`)).status, 404);
});

test('insights: dismiss and feedback validate and scope to the owner', async () => {
  assert.equal((await call('POST', `/api/insights/${ids.insight}/feedback`, { feedback: 'meh' })).status, 400);
  const fb = await call('POST', `/api/insights/${ids.insight}/feedback`, { feedback: 'useful' });
  assert.equal(fb.body.insight.user_feedback, 'useful');
  const dis = await call('POST', `/api/insights/${ids.insight}/dismiss`);
  assert.equal(dis.body.insight.lifecycle_state, 'dismissed');
  assert.equal((await call('POST', '/api/insights/00000000-0000-0000-0000-000000000000/dismiss')).status, 404);
});

test('medication doses: slot rules, undo, 404 for someone else\'s medicine', async () => {
  assert.equal((await call('POST', `/api/medications/${ids.med}/doses`, { slot: 'night', status: 'taken' })).status, 400);
  assert.equal((await call('POST', `/api/medications/${ids.med}/doses`, { slot: 'morning', status: 'bogus' })).status, 400);
  const taken = await call('POST', `/api/medications/${ids.med}/doses`, { slot: 'morning', status: 'taken' });
  assert.equal(taken.status, 200);
  assert.equal(taken.body.reminder.takenCount, 1);
  const undo = await call('POST', `/api/medications/${ids.med}/doses`, { slot: 'morning', status: 'undo' });
  assert.equal(undo.body.reminder.takenCount, 0);
  assert.equal((await call('POST', `/api/medications/${ids.otherMed}/doses`, { slot: 'morning', status: 'taken' })).status, 404);
});

test('medication alerts: dismiss', async () => {
  assert.equal((await call('POST', `/api/medications/alerts/${ids.alert}/dismiss`)).body.alert.lifecycle_state, 'dismissed');
  assert.equal((await call('POST', `/api/medications/alerts/${ids.alert}/dismiss`)).status, 200);
  assert.equal((await call('POST', '/api/medications/alerts/00000000-0000-0000-0000-000000000000/dismiss')).status, 404);
});

test('activity log: partial upserts keep earlier fields, bad numbers are 400', async () => {
  assert.equal((await call('POST', '/api/activity', { steps: -1 })).status, 400);
  await call('POST', '/api/activity', { steps: 1000 });
  const second = await call('POST', '/api/activity', { exercise_minutes: 20 });
  assert.equal(second.body.log.steps, 1000);
  assert.equal(second.body.log.exerciseMinutes, 20);
  assert.equal(second.body.goals.steps, 10000);
});

test('weight goal: validation and round trip', async () => {
  assert.equal((await call('PUT', '/api/weight-goal', { targetWeightKg: -4 })).status, 400);
  assert.equal((await call('PUT', '/api/weight-goal', { targetDate: 'not-a-date' })).status, 400);
  const put = await call('PUT', '/api/weight-goal', { currentWeightKg: 80, targetWeightKg: 72, targetDate: '2027-01-01' });
  assert.deepEqual(put.body, { currentWeightKg: 80, targetWeightKg: 72, targetDate: '2027-01-01' });
  assert.deepEqual((await call('GET', '/api/weight-goal')).body, put.body);
});
