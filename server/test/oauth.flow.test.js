const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const pool = require('../src/db/pool');
const app = require('../src/app');
const authService = require('../src/services/authService');
const { providers } = require('../src/oauth/router');
const oauthService = require('../src/oauth/service');
const consentService = require('../src/security/consentService');

// OAuth 2.1 for the MCP connector, over real HTTP: dynamic registration,
// PKCE authorization-code flow, refresh rotation + reuse detection, scope
// narrowing, revocation, and the "existing accounts only" rule.

let server;
let baseUrl;
let user;
let session;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const realGoogle = providers.google;

async function post(path, body, { form } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

async function register() {
  const r = await post('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] });
  assert.equal(r.status, 201);
  return r.body.client_id;
}

async function authorize(clientId, { scope = 'health:read health:log', approve = ['health:read'] } = {}) {
  const { verifier, challenge } = pkce();
  const params = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
    state: 'xyz',
  };
  const login = await post('/oauth/authorize/login', { provider: 'google', credential: 'fake', params });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const approved = await post('/oauth/authorize/approve', {
    ticket: login.body.ticket,
    params,
    scopes: approve,
    consentExternalAi: true,
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const redirect = new URL(approved.body.redirect);
  assert.equal(redirect.searchParams.get('state'), 'xyz');
  return { code: redirect.searchParams.get('code'), verifier, params };
}

function tokenReq(clientId, a) {
  return post(
    '/oauth/token',
    { grant_type: 'authorization_code', client_id: clientId, code: a.code, redirect_uri: REDIRECT, code_verifier: a.verifier },
    { form: true }
  );
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await pool.query(`DELETE FROM users WHERE auth_provider = 'google' AND provider_user_id = 'g-oauth-test'`);
  const { rows } = await pool.query(
    `INSERT INTO users (auth_provider, provider_user_id, display_name, email) VALUES ('google', 'g-oauth-test', 'OAuth Tester', 'oauth@example.com') RETURNING *`
  );
  user = rows[0];
  session = authService.signSession(user);
  providers.google = async (credential) => {
    if (credential === 'fake') return { providerUserId: 'g-oauth-test', email: 'oauth@example.com', displayName: 'OAuth Tester' };
    if (credential === 'stranger') return { providerUserId: 'g-nobody', email: null, displayName: null };
    throw new Error('bad token');
  };
});

test.after(async () => {
  providers.google = realGoogle;
  await pool.query(`DELETE FROM oauth_clients WHERE client_name = 'Claude'`);
  await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('metadata documents advertise PKCE-only public-client flow', async () => {
  const as = await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
  const pr = await (await fetch(`${baseUrl}/.well-known/oauth-protected-resource`)).json();
  assert.ok(pr.resource.endsWith('/mcp'));
  assert.deepEqual(pr.authorization_servers, [as.issuer]);
});

test('registration rejects insecure or empty redirect URIs', async () => {
  assert.equal((await post('/oauth/register', { client_name: 'x', redirect_uris: ['http://evil.example/cb'] })).status, 400);
  assert.equal((await post('/oauth/register', { client_name: 'x', redirect_uris: [] })).status, 400);
  assert.equal((await post('/oauth/register', { client_name: 'x', redirect_uris: ['javascript:alert(1)'] })).status, 400);
  assert.equal((await post('/oauth/register', { client_name: 'x', redirect_uris: ['http://localhost:8123/cb'] })).status, 201);
});

test('authorize page refuses an unregistered redirect_uri instead of redirecting', async () => {
  const clientId = await register();
  const { challenge } = pkce();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'https://evil.example/cb',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const res = await fetch(`${baseUrl}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('location'), null);
});

test('authorize page requires PKCE S256', async () => {
  const clientId = await register();
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code' });
  assert.equal((await fetch(`${baseUrl}/oauth/authorize?${q}`)).status, 400);
});

test('full code flow: tokens carry only the approved scopes, and consent is recorded', async () => {
  const clientId = await register();
  const a = await authorize(clientId);
  const t = await tokenReq(clientId, a);
  assert.equal(t.status, 200);
  assert.equal(t.body.token_type, 'Bearer');
  assert.equal(t.body.scope, 'health:read');
  const verified = await oauthService.verifyAccessToken(t.body.access_token);
  assert.equal(verified.userId, user.id);
  assert.deepEqual(verified.scopes, ['health:read']);
  assert.equal(await consentService.hasConsent(user.id, 'external_ai_connector'), true);
});

test('authorization code is single use and replay revokes the grant', async () => {
  const clientId = await register();
  const a = await authorize(clientId);
  const first = await tokenReq(clientId, a);
  assert.equal(first.status, 200);
  const replay = await tokenReq(clientId, a);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'invalid_grant');
  assert.equal(await oauthService.verifyAccessToken(first.body.access_token), null);
});

test('wrong PKCE verifier is rejected', async () => {
  const clientId = await register();
  const a = await authorize(clientId);
  const t = await tokenReq(clientId, { ...a, verifier: crypto.randomBytes(32).toString('base64url') });
  assert.equal(t.status, 400);
  assert.equal(t.body.error, 'invalid_grant');
});

test('another client cannot redeem the code', async () => {
  const clientId = await register();
  const other = await register();
  const a = await authorize(clientId);
  assert.equal((await tokenReq(other, a)).status, 400);
});

test('refresh rotates tokens; reusing an old refresh token revokes the grant', async () => {
  const clientId = await register();
  const t = await tokenReq(clientId, await authorize(clientId));
  const r1 = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: t.body.refresh_token }, { form: true });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh_token, t.body.refresh_token);
  assert.ok(await oauthService.verifyAccessToken(r1.body.access_token));
  const reuse = await post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: t.body.refresh_token }, { form: true });
  assert.equal(reuse.status, 400);
  assert.equal(await oauthService.verifyAccessToken(r1.body.access_token), null);
});

test('the login ticket is bound to its request and cannot be replayed on another', async () => {
  const clientId = await register();
  const { challenge } = pkce();
  const params = { client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'health:read' };
  const login = await post('/oauth/authorize/login', { provider: 'google', credential: 'fake', params });
  const tampered = { ...params, scope: 'health:read health:write' };
  const r = await post('/oauth/authorize/approve', { ticket: login.body.ticket, params: tampered, scopes: ['health:write'] });
  assert.equal(r.status, 401);
});

test('a session JWT is not accepted as a ticket and accounts must already exist', async () => {
  const clientId = await register();
  const { challenge } = pkce();
  const params = { client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
  assert.equal((await post('/oauth/authorize/approve', { ticket: session, params, scopes: ['health:read'] })).status, 401);
  const stranger = await post('/oauth/authorize/login', { provider: 'google', credential: 'stranger', params });
  assert.equal(stranger.status, 403);
  assert.equal((await post('/oauth/authorize/login', { provider: 'google', credential: 'garbage', params })).status, 401);
});

test('user can list and revoke connected apps; revocation kills the token', async () => {
  const clientId = await register();
  const t = await tokenReq(clientId, await authorize(clientId));
  const auth = { Authorization: `Bearer ${session}` };
  const list = await (await fetch(`${baseUrl}/api/connected-apps`, { headers: auth })).json();
  const mine = list.apps.find((a) => a.name === 'Claude');
  assert.ok(mine);
  const del = await fetch(`${baseUrl}/api/connected-apps/${mine.id}`, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 204);
  assert.equal(await oauthService.verifyAccessToken(t.body.access_token), null);
});

test('RFC 7009 revoke endpoint invalidates the grant', async () => {
  const clientId = await register();
  const t = await tokenReq(clientId, await authorize(clientId));
  const r = await post('/oauth/revoke', { client_id: clientId, token: t.body.refresh_token }, { form: true });
  assert.equal(r.status, 200);
  assert.equal(await oauthService.verifyAccessToken(t.body.access_token), null);
});
