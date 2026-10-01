const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { callTool, toolList } = require('../src/mcp/gateway');
const { listTools } = require('../src/mcp/tools');
const consentService = require('../src/security/consentService');

// Every MCP tool, called through the real gateway against real data. Two
// users each own data; every read tool must return only the caller's.

const ALL_SCOPES = ['health:read', 'health:log', 'health:write', 'family:manage'];
let a;
let b;

function authFor(user, scopes = ALL_SCOPES) {
  return { userId: user.id, grantId: `test-grant-${user.id}`, scopes, clientId: 'x' };
}

async function mkUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [`TOOLT ${name}`]);
  await consentService.setConsent({ userId: rows[0].id, consentType: 'external_ai_connector', granted: true });
  return rows[0];
}

test.before(async () => {
  a = await mkUser('A');
  b = await mkUser('B');
  await pool.query(`INSERT INTO water_entries (user_id, amount_ml, logged_at) VALUES ($1, 250, now()), ($2, 999, now())`, [a.id, b.id]);
  await pool.query(`INSERT INTO kitchen_items (user_id, name, category) VALUES ($1, 'A-only lentils', 'legume'), ($2, 'B-only quinoa', 'grain')`, [a.id, b.id]);
  const policy = await pool.query(
    `INSERT INTO insurance_policies (user_id, original_filename, file_extension, provider_name, plan_name, ingestion_status, confirmed_at)
     VALUES ($1, 'b.pdf', 'pdf', 'Insurer B', 'Plan B', 'Completed', now()) RETURNING id`,
    [b.id]
  );
  b.policyId = policy.rows[0].id;
});

test.after(async () => {
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'TOOLT %'`);
  await pool.end();
});

test('every tool has a valid definition: unique name, known scope, annotations, object schema', () => {
  const names = new Set();
  for (const t of listTools()) {
    assert.ok(!names.has(t.name), `duplicate ${t.name}`);
    names.add(t.name);
    assert.ok(['health:read', 'health:log', 'health:write', 'family:manage'].includes(t.scope), `${t.name} scope`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} schema`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', `${t.name} readOnlyHint`);
    assert.ok(t.description.length > 20, `${t.name} description`);
    assert.equal(typeof t.execute, 'function');
    // No tool may let the model name a user directly.
    for (const bad of ['userId', 'user_id', 'accountId']) assert.equal(t.inputSchema.properties?.[bad], undefined, `${t.name} exposes ${bad}`);
  }
});

test('every read tool runs against a user with no data without throwing', async () => {
  const empty = await mkUser('Empty');
  const skip = new Set(['get_report_by_id', 'get_medication_detail', 'get_insurance_policy', 'compare_reports', 'get_measurement_trend', 'get_highest_or_lowest_in_range', 'find_measurements_in_date_range', 'explain_insight']);
  for (const t of listTools().filter((x) => x.annotations.readOnlyHint && !skip.has(x.name))) {
    const required = t.inputSchema.required || [];
    if (required.length) continue;
    const r = await callTool(authFor(empty), t.name, {});
    assert.ok(r && 'data' in r, `${t.name} returned no data`);
  }
});

test('water tools return only the caller\'s entries', async () => {
  const mine = await callTool(authFor(a), 'get_water_summary', {});
  assert.equal(mine.data.totalMl, 250);
  const theirs = await callTool(authFor(b), 'get_water_summary', {});
  assert.equal(theirs.data.totalMl, 999);
  const hist = await callTool(authFor(a), 'get_water_history', { days: 3 });
  assert.equal(hist.data.days.length, 3);
  assert.equal(hist.data.days.reduce((n, d) => n + d.totalMl, 0), 250);
});

test('kitchen items are the caller\'s only', async () => {
  const mine = await callTool(authFor(a), 'list_kitchen_items', {});
  assert.deepEqual(mine.data.items.map((i) => i.name), ['A-only lentils']);
});

test('insurance: owner can read a policy, another user gets found:false', async () => {
  const owner = await callTool(authFor(b), 'get_insurance_policy', { policyId: b.policyId });
  assert.equal(owner.data.found, true);
  const intruder = await callTool(authFor(a), 'get_insurance_policy', { policyId: b.policyId });
  assert.deepEqual(intruder.data, { found: false });
  const overview = await callTool(authFor(a), 'get_insurance_overview', {});
  assert.ok(!JSON.stringify(overview.data).includes('Plan B'));
});

test('consents tool is read-only and reports the connector consent', async () => {
  const r = await callTool(authFor(a), 'get_privacy_consents', {});
  assert.equal(r.data.consents.find((c) => c.type === 'external_ai_connector').granted, true);
});

test('family dashboard needs the family:manage scope', async () => {
  await assert.rejects(() => callTool(authFor(a, ['health:read']), 'get_family_dashboard', {}), /family:manage/);
  const r = await callTool(authFor(a, ['family:manage']), 'get_family_dashboard', {});
  assert.deepEqual(r.data.beneficiaries, []);
});

test('toolList hides tools outside the grant but keeps ordering stable', () => {
  const read = toolList({ scopes: ['health:read'] }).map((t) => t.name);
  const family = toolList({ scopes: ['family:manage'] }).map((t) => t.name);
  assert.ok(read.includes('get_water_summary') && !read.includes('get_family_dashboard'));
  assert.deepEqual(family, ['get_family_dashboard']);
});

// ---- lifestyle / dashboard tools: each user's rows must stay their own ----


async function seedLifestyle() {
  const mk = async (u, tag) => {
    await pool.query(
      `INSERT INTO food_entries (user_id, name, meal_type, consumed_at, is_confirmed, calories) VALUES ($1, $2, 'lunch', now(), true, 500)`,
      [u.id, `${tag}-meal`]
    );
    await pool.query(`INSERT INTO activity_logs (user_id, log_date, steps) VALUES ($1, CURRENT_DATE, $2)`, [u.id, tag === 'A' ? 4321 : 8765]);
    await pool.query(`INSERT INTO glucose_readings (user_id, measured_at, value_mg_dl) VALUES ($1, now(), $2)`, [u.id, tag === 'A' ? 101.5 : 217.5]);
    const sch = await pool.query(
      `INSERT INTO diet_schedules (user_id, title, duration_days, start_date, source_type) VALUES ($1, $2, 7, CURRENT_DATE, 'manual') RETURNING id`,
      [u.id, `${tag}-plan`]
    );
    u.scheduleId = sch.rows[0].id;
    const rep = await pool.query(
      `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
       VALUES ($1, $2, 'text/csv', 'csv', 1, '/tmp/x', 'Completed', CURRENT_DATE) RETURNING id`,
      [u.id, `${tag}-report.csv`]
    );
    u.reportId = rep.rows[0].id;
  };
  await mk(a, 'A');
  await mk(b, 'B');
}

test('diet tools return only the caller\'s meals and schedules', async () => {
  await seedLifestyle();
  const entries = await callTool(authFor(a), 'list_food_entries', {});
  assert.deepEqual(entries.data.entries.map((e) => e.name), ['A-meal']);
  const summary = await callTool(authFor(a), 'get_diet_summary', { days: 1 });
  assert.equal(summary.data.today.calories, 500);
  const schedules = await callTool(authFor(a), 'list_diet_schedules', {});
  assert.deepEqual(schedules.data.schedules.map((s) => s.title), ['A-plan']);
  const stolen = await callTool(authFor(a), 'get_diet_schedule', { scheduleId: b.scheduleId });
  assert.equal(stolen.data.found, false);
  const own = await callTool(authFor(a), 'get_diet_schedule', { scheduleId: a.scheduleId });
  assert.equal(own.data.found, true);
});

test('activity and glucose tools are scoped to the caller', async () => {
  const act = await callTool(authFor(a), 'get_activity_summary', { days: 3 });
  assert.equal(act.data.today.steps, 4321);
  const glu = await callTool(authFor(b), 'get_glucose_summary', { days: 3 });
  assert.ok(JSON.stringify(glu.data).includes('217.5'));
  assert.ok(!JSON.stringify((await callTool(authFor(a), 'get_glucose_summary', { days: 3 })).data).includes('217.5'));
});

test('timeline lists only the caller\'s reports and honours filters', async () => {
  const mine = await callTool(authFor(a), 'list_timeline', {});
  assert.deepEqual(mine.data.timeline.map((r) => r.original_filename), ['A-report.csv']);
  const none = await callTool(authFor(a), 'list_timeline', { search: 'B-report' });
  assert.deepEqual(none.data.timeline, []);
});

test('dashboard tools run for a user with data and never include another user\'s report', async () => {
  for (const name of ['get_dashboard_snapshot', 'get_organ_health', 'get_needs_attention']) {
    const r = await callTool(authFor(a), name, {});
    assert.ok(!JSON.stringify(r.data).includes('B-report'), `${name} leaked`);
  }
});

test('workout, vitals and device tools run for a user with no data', async () => {
  for (const name of ['list_workouts', 'get_workout_analytics', 'list_workout_plans', 'list_exercises', 'get_vitals_summary', 'list_devices']) {
    const r = await callTool(authFor(a), name, {});
    assert.ok('data' in r, name);
  }
});
