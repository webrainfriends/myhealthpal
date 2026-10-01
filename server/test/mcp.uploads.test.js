const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const pool = require('../src/db/pool');
const config = require('../src/config');
const ingestionService = require('../src/services/ingestionService');

// Background processing is irrelevant here (it would need an AI key); the
// pipeline up to "stored encrypted + row created" is what is under test.
ingestionService.enqueueProcessing = () => {};

const app = require('../src/app');
const oauthService = require('../src/oauth/service');
const consentService = require('../src/security/consentService');
const { setKeyProvider } = require('../src/security/keyProvider');
const { createLocalDevProvider } = require('../src/security/providers/localDev');

// create_upload_link -> /mcp-upload/<token>: the model gets a one-time link,
// the person uploads in a browser, and the file goes through the app's own
// secure pipeline for the right person.

let server;
let baseUrl;
let vaultDir;
let savedSecurity;
let clientId;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const u = {};
const CSV = 'Test,Value,Unit,Reference Range\nHemoglobin,13.5,g/dL,12-16\n';

async function makeUser(name, { storage = true } = {}) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [`MCPU ${name}`]);
  await consentService.setConsent({ userId: rows[0].id, consentType: 'external_ai_connector', granted: true });
  if (storage) await consentService.setConsent({ userId: rows[0].id, consentType: 'medical_record_storage', granted: true });
  return rows[0];
}

async function connect(user, scopes = ['health:read', 'health:write']) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const params = {
    client_id: clientId, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: scopes.join(' '),
  };
  const { code } = await oauthService.approveAuthorization({ userId: user.id, params, approvedScopes: scopes });
  const t = (await oauthService.exchangeCode({ clientId, code, redirectUri: REDIRECT, codeVerifier: verifier })).access_token;
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}

async function link(client, args = {}) {
  const res = await client.callTool({ name: 'create_upload_link', arguments: args });
  const body = JSON.parse(res.content[0].text);
  return { isError: Boolean(res.isError), body, url: body.data?.url && body.data.url.replace(config.publicBaseUrl, baseUrl) };
}

function form(content, filename, type, extra = {}) {
  const f = new FormData();
  f.append('file', new Blob([content], { type }), filename);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

const reports = async (userId) => (await pool.query(`SELECT id, original_filename, encrypted_at FROM reports WHERE user_id = $1`, [userId])).rows;

test.before(async () => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-mcp-'));
  savedSecurity = { ...config.security };
  config.security.encryptedStoreDir = vaultDir;
  setKeyProvider(createLocalDevProvider({ masterKeyHex: crypto.randomBytes(32).toString('hex'), nodeEnv: 'test' }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  clientId = (await oauthService.registerClient({ clientName: 'MCP Uploads', redirectUris: [REDIRECT] })).client_id;
  for (const n of ['owner', 'managed', 'viewonly', 'nostorage']) u[n] = await makeUser(n, { storage: n !== 'nostorage' });
  await pool.query(
    `INSERT INTO family_links (owner_user_id, member_user_id, access, role) VALUES ($1,$2,'manage','caretaker'), ($1,$3,'view','caretaker')`,
    [u.owner.id, u.managed.id, u.viewonly.id]
  );
});

test.after(async () => {
  Object.assign(config.security, savedSecurity);
  await pool.query(`DELETE FROM oauth_clients WHERE client_name LIKE 'MCP Uploads%'`);
  await pool.query(`DELETE FROM users WHERE display_name LIKE 'MCPU %'`);
  fs.rmSync(vaultDir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('the tool needs health:write and is refused for view-only profiles', async () => {
  const readOnly = await connect(u.owner, ['health:read']);
  assert.equal((await link(readOnly)).body.error, 'insufficient_scope');
  await readOnly.close();
  const client = await connect(u.owner);
  assert.equal((await link(client)).isError, false);
  const res = await client.callTool({ name: 'create_upload_link', arguments: { profileId: u.viewonly.id } });
  assert.equal(JSON.parse(res.content[0].text).error, 'view_only');
  await client.close();
});

test('the link opens an upload page; the file lands encrypted for the right person, once', async () => {
  const client = await connect(u.owner);
  const { url, body } = await link(client);
  assert.match(body.data.url, /\/mcp-upload\/[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(body.data.expiresInMinutes, 15);

  const pageRes = await fetch(url);
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await pageRes.text(), /type="file"/);

  const up = await fetch(url, { method: 'POST', body: form(CSV, 'labs.csv', 'text/csv') });
  assert.equal(up.status, 201, await up.clone().text());
  const result = await up.json();
  assert.equal(result.category, 'lab_report');
  const mine = await reports(u.owner.id);
  assert.equal(mine.length, 1);
  assert.ok(mine[0].encrypted_at, 'stored via the encrypted vault');
  assert.ok(fs.readdirSync(vaultDir).length >= 1);
  const onDisk = fs.readdirSync(vaultDir).map((f) => fs.readFileSync(path.join(vaultDir, f)).toString('latin1')).join('');
  assert.ok(!onDisk.includes('Hemoglobin'), 'plaintext must never be on disk');

  const again = await fetch(url, { method: 'POST', body: form(CSV, 'labs2.csv', 'text/csv') });
  assert.equal(again.status, 410);
  assert.equal((await fetch(url)).status, 410);
  assert.equal((await reports(u.owner.id)).length, 1);
  await client.close();
});

test('a link made for a managed profile files the document under that profile, not the caretaker', async () => {
  const client = await connect(u.owner);
  const { url } = await link(client, { profileId: u.managed.id });
  assert.equal((await fetch(url, { method: 'POST', body: form(CSV, 'managed.csv', 'text/csv') })).status, 201);
  assert.equal((await reports(u.managed.id)).length, 1);
  assert.equal((await reports(u.owner.id)).filter((r) => r.original_filename === 'managed.csv').length, 0);
  await client.close();
});

test('a rejected file does not spend the link; a tampered, expired or foreign token is refused', async () => {
  const client = await connect(u.owner);
  const { url } = await link(client);
  const bad = await fetch(url, { method: 'POST', body: form('not really a pdf', 'fake.pdf', 'application/pdf') });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(url, { method: 'POST', body: form(CSV, 'retry.csv', 'text/csv') })).status, 201);

  const token = url.split('/').pop();
  const tampered = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
  assert.equal((await fetch(`${baseUrl}/mcp-upload/${tampered}`)).status, 410);
  assert.equal((await fetch(`${baseUrl}/mcp-upload/not-a-token`)).status, 410);
  // a session JWT or other token type is not an upload token
  const sessionish = jwt.sign({ sub: u.owner.id, type: 'mcp_confirm' }, config.jwtSecret);
  assert.equal((await fetch(`${baseUrl}/mcp-upload/${sessionish}`)).status, 410);
  const expired = jwt.sign({ type: 'mcp_upload' }, crypto.randomBytes(8), { expiresIn: -10 });
  assert.equal((await fetch(`${baseUrl}/mcp-upload/${expired}`, { method: 'POST', body: form(CSV, 'x.csv', 'text/csv') })).status, 410);
  await client.close();
});

test('revoking the app, withdrawing consent or losing family access kills outstanding links', async () => {
  const client = await connect(u.owner);
  const a = await link(client);
  const grant = (await oauthService.listGrants(u.owner.id))[0];
  await oauthService.revokeUserGrant(u.owner.id, grant.id);
  const res = await fetch(a.url, { method: 'POST', body: form(CSV, 'late.csv', 'text/csv') });
  assert.equal(res.status, 410);
  await client.close().catch(() => {});

  const c2 = await connect(u.owner);
  const b = await link(c2, { profileId: u.managed.id });
  await consentService.setConsent({ userId: u.managed.id, consentType: 'external_ai_connector', granted: false });
  assert.equal((await fetch(b.url)).status, 403);
  await consentService.setConsent({ userId: u.managed.id, consentType: 'external_ai_connector', granted: true });
  await pool.query(`UPDATE family_links SET access = 'view' WHERE owner_user_id = $1 AND member_user_id = $2`, [u.owner.id, u.managed.id]);
  assert.equal((await fetch(b.url)).status, 403);
  await pool.query(`UPDATE family_links SET access = 'manage' WHERE owner_user_id = $1 AND member_user_id = $2`, [u.owner.id, u.managed.id]);
  await c2.close();
});

test('the app\'s own storage consent still applies', async () => {
  const client = await connect(u.nostorage);
  const { url } = await link(client);
  const res = await fetch(url, { method: 'POST', body: form(CSV, 'nostorage.csv', 'text/csv') });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'consent_required');
  assert.equal((await reports(u.nostorage.id)).length, 0);
  await client.close();
});

test('uploads are audited as MCP calls', async () => {
  const rows = await pool.query(`SELECT 1 FROM security_audit_events WHERE event_type = 'MCP_TOOL_CALLED' AND purpose = 'upload_via_link' AND user_id = $1`, [u.managed.id]);
  assert.ok(rows.rowCount >= 1);
});
