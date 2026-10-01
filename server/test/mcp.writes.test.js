const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const pool = require('../src/db/pool');
const app = require('../src/app');
const oauthService = require('../src/oauth/service');
const consentService = require('../src/security/consentService');
const { listTools } = require('../src/mcp/tools');

// Write tools over real MCP: scopes, view-only links, sponsors, cross-user
// targets, validation, and that effects land on the right person's rows.

let server;
let baseUrl;
let clientId;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const u = {};
const ids = {};

async function makeUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [`MCPW ${name}`]);
  await consentService.setConsent({ userId: rows[0].id, consentType: 'external_ai_connector', granted: true });
  return rows[0];
}

async function token(user, scopes) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const params = {
    client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: scopes.join(' '),
  };
  const { code } = await oauthService.approveAuthorization({ userId: user.id, params, approvedScopes: scopes });
  return (await oauthService.exchangeCode({ clientId, code, redirectUri: REDIRECT, codeVerifier: verifier })).access_token;
}

async function connect(user, scopes) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const t = await token(user, scopes);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), body: JSON.parse(res.content[0].text) };
}

const count = async (table, userId) => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [userId])).rows[0].n;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  clientId = (await oauthService.registerClient({ clientName: 'MCP Writes', redirectUris: [REDIRECT] })).client_id;
  for (const n of ['owner', 'managed', 'viewonly', 'sponsored', 'other']) u[n] = await makeUser(n);
  await pool.query(
    `INSERT INTO family_links (owner_user_id, member_user_id, access, role) VALUES ($1,$2,'manage','caretaker'), ($1,$3,'view','caretaker'), ($1,$4,'view','sponsor')`,
    [u.owner.id, u.managed.id, u.viewonly.id, u.sponsored.id]
  );
  ids.insight = (await pool.query(
    `INSERT INTO insights (user_id, insight_type, title, explanation, evidence, dedup_key) VALUES ($1, 'new_result', 'T', 'E', '[]', 'mw-1') RETURNING id`, [u.other.id]
  )).rows[0].id;
  ids.med = (await pool.query(
    `INSERT INTO medications (user_id, name, status, is_confirmed, times_of_day, total_doses) VALUES ($1, 'MwMed', 'active', true, ARRAY['morning'], 5) RETURNING id`, [u.owner.id]
  )).rows[0].id;
});

test.after(async () => {
  await pool.query(`DELETE FROM oauth_clients WHERE client_id = $1`, [clientId]);
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'MCPW %'`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('every write tool is non-read-only and scoped log/write; one-step deletes do not exist', () => {
  const writes = listTools().filter((t) => t.annotations.readOnlyHint === false);
  assert.ok(writes.length >= 25);
  for (const t of writes) {
    assert.ok(['health:log', 'health:write'].includes(t.scope), `${t.name} scope ${t.scope}`);
    const removes = /^(delete|remove)_/.test(t.name);
    // Removals are flagged destructive and declare the confirmation field;
    // nothing else may be.
    assert.equal(t.annotations.destructiveHint, removes, `${t.name} destructiveHint`);
    if (removes) assert.ok(t.inputSchema.properties.confirmationToken, `${t.name} must be two-step`);
  }
  for (const t of listTools().filter((x) => x.annotations.readOnlyHint === true)) assert.ok(!t.mutates, `${t.name} flagged mutating`);
  for (const forbidden of ['delete_account', 'delete_user', 'rewrap_keys', 'set_consent']) {
    assert.ok(!listTools().some((t) => t.name === forbidden), `${forbidden} must not be exposed`);
  }
});

test('a read-only grant cannot see or call write tools, and nothing is written', async () => {
  const client = await connect(u.owner, ['health:read']);
  assert.ok(!(await client.listTools()).tools.some((t) => t.name === 'log_water'));
  const r = await call(client, 'log_water', { amountMl: 250 });
  assert.equal(r.body.error, 'insufficient_scope');
  assert.equal(await count('water_entries', u.owner.id), 0);
  await client.close();
});

test('health:log lets the owner log, but not use health:write tools', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log']);
  const r = await call(client, 'log_water', { amountMl: 300 });
  assert.equal(r.isError, false);
  assert.equal(r.body.data.entry.amount_ml, 300);
  assert.equal(await count('water_entries', u.owner.id), 1);
  assert.equal((await call(client, 'add_allergy', { allergen: 'peanuts' })).body.error, 'insufficient_scope');
  await client.close();
});

test('a caretaker with manage access logs for the managed profile, not for themselves', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log']);
  const before = await count('water_entries', u.owner.id);
  const r = await call(client, 'log_water', { amountMl: 500, profileId: u.managed.id });
  assert.equal(r.isError, false);
  assert.equal(await count('water_entries', u.managed.id), 1);
  assert.equal(await count('water_entries', u.owner.id), before);
  await client.close();
});

test('view-only links can be read but never written; sponsors and strangers are refused outright', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log', 'health:write']);
  const w = await call(client, 'log_water', { amountMl: 100, profileId: u.viewonly.id });
  assert.equal(w.body.error, 'view_only');
  assert.equal(await count('water_entries', u.viewonly.id), 0);
  assert.equal((await call(client, 'get_water_summary', { profileId: u.viewonly.id })).isError, false);
  for (const target of [u.sponsored.id, u.other.id]) {
    assert.equal((await call(client, 'log_water', { amountMl: 100, profileId: target })).body.error, 'profile_forbidden');
  }
  assert.equal(await count('water_entries', u.sponsored.id), 0);
  assert.equal(await count('water_entries', u.other.id), 0);
  await client.close();
});

test('another user\'s records cannot be modified by id', async () => {
  const client = await connect(u.owner, ['health:read', 'health:write']);
  const r = await call(client, 'dismiss_insight', { insightId: ids.insight });
  assert.equal(r.isError, true);
  assert.equal(r.body.error, 'invalid_request');
  assert.match(r.body.message, /not found/i);
  const row = (await pool.query(`SELECT lifecycle_state FROM insights WHERE id = $1`, [ids.insight])).rows[0];
  assert.equal(row.lifecycle_state, 'active');
  await client.close();
});

test('validation errors reach the model as readable messages and write nothing', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log', 'health:write']);
  const before = await count('food_entries', u.owner.id);
  for (const [name, args, pattern] of [
    ['log_meal', { name: '   ' }, /name is required/],
    ['log_meal', { name: 'Rice', mealType: 'brunch' }, /mealType must be/],
    ['log_meal', { name: 'Rice', calories: -5 }, /calories must be/],
    ['log_meal', { name: 'Rice', consumedAt: 'yesterday-ish' }, /not valid/],
    ['log_water', { amountMl: 0 }, /./],
    ['log_weight', { weightKg: -1 }, /weightKg/],
    ['upsert_kitchen_item', { name: 'x', category: 'sweets' }, /category must be/],
    ['set_weight_goal', { targetWeightKg: -3 }, /positive/],
  ]) {
    const r = await call(client, name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} should fail`);
    assert.match(r.body.message, pattern);
  }
  assert.equal(await count('food_entries', u.owner.id), before);
  await client.close();
});

test('log_meal, log_medication_dose, log_activity and retest/kitchen/goal tools work end to end', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log', 'health:write']);
  const meal = await call(client, 'log_meal', { name: 'Dal rice', calories: 450, mealType: 'lunch' });
  assert.equal(meal.body.data.entry.is_confirmed, true);
  assert.equal((await call(client, 'list_food_entries', {})).body.data.entries.some((e) => e.name === 'Dal rice'), true);

  const dose = await call(client, 'log_medication_dose', { medicationId: ids.med, slot: 'morning', status: 'taken' });
  assert.equal(dose.body.data.reminder.takenCount, 1);
  assert.equal((await call(client, 'log_medication_dose', { medicationId: ids.med, slot: 'midnight', status: 'taken' })).isError, true);
  const undone = await call(client, 'log_medication_dose', { medicationId: ids.med, slot: 'morning', status: 'undo' });
  assert.equal(undone.body.data.reminder.takenCount, 0);

  await call(client, 'log_activity', { steps: 2500 });
  assert.equal((await call(client, 'get_activity_summary', { days: 1 })).body.data.today.steps, 2500);

  assert.equal((await call(client, 'upsert_kitchen_item', { name: 'Brown rice', category: 'grain', quantityAmount: 2, quantityUnit: 'cup' })).isError, false);
  assert.equal((await call(client, 'set_weight_goal', { currentWeightKg: 80, targetWeightKg: 74 })).body.data.targetWeightKg, 74);
  assert.equal((await call(client, 'add_allergy', { allergen: 'Shellfish' })).isError, false);
  await client.close();
});

test('writes are audited by tool name, denials are audited too', async () => {
  const client = await connect(u.owner, ['health:read', 'health:log']);
  await call(client, 'log_water', { amountMl: 200 });
  await call(client, 'add_allergy', { allergen: 'x' });
  const rows = (await pool.query(
    `SELECT event_type, purpose FROM security_audit_events WHERE actor_user_id = $1 AND purpose IN ('log_water', 'add_allergy:scope')`, [u.owner.id]
  )).rows;
  assert.ok(rows.some((r) => r.event_type === 'MCP_TOOL_CALLED' && r.purpose === 'log_water'));
  assert.ok(rows.some((r) => r.event_type === 'MCP_TOOL_DENIED' && r.purpose === 'add_allergy:scope'));
  await client.close();
});
