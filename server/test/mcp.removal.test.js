const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const pool = require('../src/db/pool');
const app = require('../src/app');
const oauthService = require('../src/oauth/service');
const consentService = require('../src/security/consentService');
const confirmation = require('../src/mcp/confirmation');

// Permanent deletes over real MCP: nothing happens on the first call, the
// confirmation token is bound to connection+person+tool+target and single
// use, and another user's ids are never deletable or even describable.

let server;
let baseUrl;
let clientId;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const u = {};
const ids = {};

async function makeUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [`MCPD ${name}`]);
  await consentService.setConsent({ userId: rows[0].id, consentType: 'external_ai_connector', granted: true });
  return rows[0];
}

async function connect(user, scopes = ['health:read', 'health:write'], cid = clientId) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const params = {
    client_id: cid, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: scopes.join(' '),
  };
  const { code } = await oauthService.approveAuthorization({ userId: user.id, params, approvedScopes: scopes });
  const t = (await oauthService.exchangeCode({ clientId: cid, code, redirectUri: REDIRECT, codeVerifier: verifier })).access_token;
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), body: JSON.parse(res.content[0].text) };
}

const exists = async (table, id) => (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  clientId = (await oauthService.registerClient({ clientName: 'MCP Removal', redirectUris: [REDIRECT] })).client_id;
  for (const n of ['owner', 'other', 'viewonly']) u[n] = await makeUser(n);
  await pool.query(`INSERT INTO family_links (owner_user_id, member_user_id, access, role) VALUES ($1,$2,'view','caretaker')`, [u.owner.id, u.viewonly.id]);
  ids.food = (await pool.query(`INSERT INTO food_entries (user_id, name, meal_type, consumed_at, calories) VALUES ($1,'Del me','lunch',now(),250) RETURNING id`, [u.owner.id])).rows[0].id;
  ids.food2 = (await pool.query(`INSERT INTO food_entries (user_id, name, meal_type, consumed_at) VALUES ($1,'Keep me','lunch',now()) RETURNING id`, [u.owner.id])).rows[0].id;
  ids.otherFood = (await pool.query(`INSERT INTO food_entries (user_id, name, meal_type, consumed_at) VALUES ($1,'Secret','lunch',now()) RETURNING id`, [u.other.id])).rows[0].id;
  ids.viewFood = (await pool.query(`INSERT INTO food_entries (user_id, name, meal_type, consumed_at) VALUES ($1,'Viewonly food','lunch',now()) RETURNING id`, [u.viewonly.id])).rows[0].id;
  ids.report = (await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path) VALUES ($1,'del.csv','text/csv','csv',1,'/tmp/none') RETURNING id`, [u.owner.id]
  )).rows[0].id;
  ids.otherReport = (await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path) VALUES ($1,'other.csv','text/csv','csv',1,'/tmp/none') RETURNING id`, [u.other.id]
  )).rows[0].id;
  ids.allergy = (await pool.query(`INSERT INTO user_allergies (user_id, allergen) VALUES ($1,'Peanuts') RETURNING id`, [u.owner.id])).rows[0].id;
});

test.after(async () => {
  await pool.query(`DELETE FROM oauth_clients WHERE client_name LIKE 'MCP Removal%'`);
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'MCPD %'`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('first call only describes: nothing is deleted and a token is returned', async () => {
  const client = await connect(u.owner);
  const r = await call(client, 'delete_food_entry', { entryId: ids.food });
  assert.equal(r.isError, false);
  assert.equal(r.body.data.confirmationRequired, true);
  assert.match(r.body.data.summary, /Del me.*250 kcal/);
  assert.ok(r.body.data.confirmationToken);
  assert.equal(await exists('food_entries', ids.food), true);
  await client.close();
});

test('second call with the token deletes; the token cannot be reused', async () => {
  const client = await connect(u.owner);
  const first = await call(client, 'delete_food_entry', { entryId: ids.food });
  const token = first.body.data.confirmationToken;
  const done = await call(client, 'delete_food_entry', { entryId: ids.food, confirmationToken: token });
  assert.equal(done.body.data.deleted, true);
  assert.equal(await exists('food_entries', ids.food), false);
  assert.equal(await exists('food_entries', ids.food2), true);
  const replay = await call(client, 'delete_food_entry', { entryId: ids.food2, confirmationToken: token });
  assert.equal(replay.isError, true);
  assert.equal(replay.body.error, 'confirmation_invalid');
  assert.equal(await exists('food_entries', ids.food2), true);
  await client.close();
});

test('a token issued for one target, tool, person or connection cannot authorise another', async () => {
  const a = await connect(u.owner);
  const secondClient = (await oauthService.registerClient({ clientName: 'MCP Removal 2', redirectUris: [REDIRECT] })).client_id;
  const b = await connect(u.owner, ['health:read', 'health:write'], secondClient); // a different connection (grant) for the same person
  const tok = (await call(a, 'delete_food_entry', { entryId: ids.food2 })).body.data.confirmationToken;
  // wrong target
  const wrongTarget = await call(a, 'delete_food_entry', { entryId: ids.report, confirmationToken: tok });
  assert.equal(wrongTarget.body.error, 'confirmation_invalid');
  // wrong tool
  const wrongTool = await call(a, 'delete_report', { reportId: ids.food2, confirmationToken: tok });
  assert.equal(wrongTool.body.error, 'confirmation_invalid');
  // wrong connection: a token minted for the first connection's grant is refused on the second
  const forged = tok;

  assert.equal((await call(b, 'delete_food_entry', { entryId: ids.food2, confirmationToken: forged })).body.error, 'confirmation_invalid');
  // garbage
  assert.equal((await call(b, 'delete_food_entry', { entryId: ids.food2, confirmationToken: 'abc' })).body.error, 'confirmation_invalid');
  assert.equal(await exists('food_entries', ids.food2), true);
  await a.close().catch(() => {});
  await b.close();
});

test('another user\'s records cannot be described or deleted', async () => {
  const client = await connect(u.owner);
  for (const [tool, args] of [['delete_food_entry', { entryId: ids.otherFood }], ['delete_report', { reportId: ids.otherReport }]]) {
    const r = await call(client, tool, args);
    assert.equal(r.isError, true, tool);
    assert.match(r.body.message, /not found/i);
    assert.ok(!JSON.stringify(r.body).includes('Secret') && !JSON.stringify(r.body).includes('other.csv'));
  }
  // even with a token minted for the right shape, deletion of a foreign id fails
  const forged = confirmation.issue({ grantId: 'x', subjectId: u.owner.id, tool: 'delete_report', targetId: ids.otherReport });
  assert.equal((await call(client, 'delete_report', { reportId: ids.otherReport, confirmationToken: forged })).isError, true);
  assert.equal(await exists('food_entries', ids.otherFood), true);
  assert.equal(await exists('reports', ids.otherReport), true);
  await client.close();
});

test('malformed ids are a clean not-found, not a server error', async () => {
  const client = await connect(u.owner);
  const r = await call(client, 'delete_report', { reportId: "x'; DROP TABLE reports;--" });
  assert.equal(r.body.error, 'invalid_request');
  await client.close();
});

test('report and allergy removal work through the shared services', async () => {
  const client = await connect(u.owner);
  const rep = await call(client, 'delete_report', { reportId: ids.report });
  assert.match(rep.body.data.summary, /del\.csv/);
  await call(client, 'delete_report', { reportId: ids.report, confirmationToken: rep.body.data.confirmationToken });
  assert.equal(await exists('reports', ids.report), false);
  const al = await call(client, 'remove_allergy', { allergyId: ids.allergy });
  await call(client, 'remove_allergy', { allergyId: ids.allergy, confirmationToken: al.body.data.confirmationToken });
  assert.equal(await exists('user_allergies', ids.allergy), false);
  const audit = await pool.query(`SELECT 1 FROM security_audit_events WHERE event_type = 'REPORT_DELETED' AND report_id = $1`, [ids.report]);
  assert.equal(audit.rowCount, 1);
  await client.close();
});

test('view-only profiles and read-only grants cannot even get a confirmation', async () => {
  const client = await connect(u.owner);
  const v = await call(client, 'delete_food_entry', { entryId: ids.viewFood, profileId: u.viewonly.id });
  assert.equal(v.body.error, 'view_only');
  assert.equal(await exists('food_entries', ids.viewFood), true);
  await client.close();
  const readOnly = await connect(u.owner, ['health:read']);
  assert.equal((await call(readOnly, 'delete_food_entry', { entryId: ids.food2 })).body.error, 'insufficient_scope');
  await readOnly.close();
});
