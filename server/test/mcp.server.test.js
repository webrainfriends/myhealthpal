const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const pool = require('../src/db/pool');
const app = require('../src/app');
const oauthService = require('../src/oauth/service');
const consentService = require('../src/security/consentService');

// The MCP endpoint end to end with the real SDK client: auth challenge,
// scope-filtered tool list, consent gate, profile resolution (family links,
// sponsors, view-only), cross-user isolation and audit rows.

let server;
let baseUrl;
const users = {};
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let clientId;

async function makeUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [`MCPT ${name}`]);
  return rows[0];
}

async function connectToken(user, scopes) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const params = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope: scopes.join(' '),
  };
  const { code } = await oauthService.approveAuthorization({ userId: user.id, params, approvedScopes: scopes });
  const t = await oauthService.exchangeCode({ clientId, code, redirectUri: REDIRECT, codeVerifier: verifier });
  return t.access_token;
}

async function connect(token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

async function call(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const body = JSON.parse(res.content[0].text);
  return { isError: Boolean(res.isError), body };
}

async function auditCount(userId, eventType, purpose) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM security_audit_events WHERE user_id = $1 AND event_type = $2 AND purpose = $3`,
    [userId, eventType, purpose]
  );
  return rows[0].n;
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  clientId = (await oauthService.registerClient({ clientName: 'MCP Test', redirectUris: [REDIRECT] })).client_id;
  for (const n of ['owner', 'other', 'managed', 'viewonly', 'sponsored', 'stranger']) users[n] = await makeUser(n);
  await pool.query(
    `INSERT INTO family_links (owner_user_id, member_user_id, access, role) VALUES
       ($1, $2, 'manage', 'caretaker'), ($1, $3, 'view', 'caretaker'), ($1, $4, 'view', 'sponsor')`,
    [users.owner.id, users.managed.id, users.viewonly.id, users.sponsored.id]
  );
  for (const n of ['owner', 'other', 'managed', 'viewonly']) {
    await consentService.setConsent({ userId: users[n].id, consentType: 'external_ai_connector', granted: true });
  }
  await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path)
     VALUES ($1, 'private.csv', 'text/csv', 'csv', 1, '/tmp/x') RETURNING id`,
    [users.other.id]
  ).then((r) => { users.other.reportId = r.rows[0].id; });
});

test.after(async () => {
  await pool.query(`DELETE FROM oauth_clients WHERE client_id = $1`, [clientId]);
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'MCPT %'`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('no token or a bad token gets a 401 pointing at the resource metadata', async () => {
  for (const headers of [{}, { Authorization: 'Bearer nope-not-a-token-at-all-xxxxx' }]) {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: '{}' });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
  }
});

test('the app session JWT is not accepted on /mcp', async () => {
  const session = require('../src/services/authService').signSession(users.owner);
  const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', Authorization: `Bearer ${session}` }, body: '{}' });
  assert.equal(res.status, 401);
});

test('GET and DELETE are not allowed (stateless server)', async () => {
  const token = await connectToken(users.owner, ['health:read']);
  assert.equal((await fetch(`${baseUrl}/mcp`, { headers: { Authorization: `Bearer ${token}` } })).status, 405);
});

test('tools/list only advertises tools within the granted scopes, with profileId added', async () => {
  const readClient = await connect(await connectToken(users.owner, ['health:read']));
  const { tools } = await readClient.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('list_profiles') && names.includes('get_latest_report'));
  assert.ok(tools.find((t) => t.name === 'get_latest_report').inputSchema.properties.profileId);
  assert.equal(tools.find((t) => t.name === 'list_profiles').inputSchema.properties.profileId, undefined);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  await readClient.close();

  const familyOnly = await connect(await connectToken(users.owner, ['family:manage']));
  assert.deepEqual((await familyOnly.listTools()).tools.map((t) => t.name), ['get_family_dashboard']);
  assert.equal((await call(familyOnly, 'get_latest_report')).body.error, 'insufficient_scope');
  await familyOnly.close();
});

test('list_profiles shows self and caretaker profiles, never sponsored ones', async () => {
  const client = await connect(await connectToken(users.owner, ['health:read']));
  const { body } = await call(client, 'list_profiles');
  const ids = body.data.profiles.map((p) => p.id);
  assert.ok(ids.includes(users.owner.id) && ids.includes(users.managed.id) && ids.includes(users.viewonly.id));
  assert.ok(!ids.includes(users.sponsored.id));
  await client.close();
});

test('without the external_ai_connector consent, nothing is returned and the denial is audited', async () => {
  const client = await connect(await connectToken(users.stranger, ['health:read']));
  const r = await call(client, 'get_latest_report');
  assert.equal(r.isError, true);
  assert.equal(r.body.error, 'consent_required');
  assert.equal(await auditCount(users.stranger.id, 'MCP_TOOL_DENIED', 'get_latest_report:consent'), 1);
  await client.close();
});

test('a user cannot reach another user\'s report through the connector', async () => {
  const client = await connect(await connectToken(users.owner, ['health:read']));
  const r = await call(client, 'get_report_by_id', { reportId: users.other.reportId });
  assert.equal(r.body.data?.found ?? false, false);
  assert.ok(!JSON.stringify(r.body).includes('private.csv'));
  await client.close();
});

test('profileId only resolves through family links: strangers, sponsors and non-members are refused', async () => {
  const client = await connect(await connectToken(users.owner, ['health:read']));
  for (const target of [users.other.id, users.sponsored.id, users.stranger.id, 'not-a-uuid']) {
    const r = await call(client, 'list_medications', { profileId: target });
    assert.equal(r.isError, true, `profile ${target} should be refused`);
    assert.equal(r.body.error, 'profile_forbidden');
  }
  const ok = await call(client, 'list_medications', { profileId: users.managed.id });
  assert.equal(ok.isError, false);
  await client.close();
});

test('acting for a family profile still needs that person\'s consent', async () => {
  await consentService.setConsent({ userId: users.managed.id, consentType: 'external_ai_connector', granted: false });
  const client = await connect(await connectToken(users.owner, ['health:read']));
  const r = await call(client, 'list_medications', { profileId: users.managed.id });
  assert.equal(r.body.error, 'consent_required');
  await consentService.setConsent({ userId: users.managed.id, consentType: 'external_ai_connector', granted: true });
  assert.equal((await call(client, 'list_medications', { profileId: users.managed.id })).isError, false);
  await client.close();
});

test('successful calls are audited by tool name only, with no arguments or results', async () => {
  const before = await auditCount(users.owner.id, 'MCP_TOOL_CALLED', 'get_latest_report');
  const client = await connect(await connectToken(users.owner, ['health:read']));
  await call(client, 'get_latest_report', { reportType: 'secret-term' });
  assert.equal(await auditCount(users.owner.id, 'MCP_TOOL_CALLED', 'get_latest_report'), before + 1);
  const { rows } = await pool.query(`SELECT * FROM security_audit_events WHERE user_id = $1 AND event_type = 'MCP_TOOL_CALLED'`, [users.owner.id]);
  assert.ok(!JSON.stringify(rows).includes('secret-term'));
  await client.close();
});

test('revoking the grant stops the token immediately', async () => {
  const token = await connectToken(users.owner, ['health:read']);
  const client = await connect(token);
  assert.equal((await call(client, 'list_profiles')).isError, false);
  const grant = (await oauthService.listGrants(users.owner.id))[0];
  await oauthService.revokeUserGrant(users.owner.id, grant.id);
  const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: '{}' });
  assert.equal(res.status, 401);
  await client.close().catch(() => {});
});
