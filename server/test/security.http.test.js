const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../src/db/pool');
const config = require('../src/config');
const ingestionService = require('../src/services/ingestionService');

// Background processing is driven explicitly below (processReport), so the
// upload route's fire-and-forget enqueue is a no-op here. Must be patched
// before the routes are loaded (they capture the function).
const realProcessReport = ingestionService.processReport;
ingestionService.enqueueProcessing = () => {};

const app = require('../src/app');
const authService = require('../src/services/authService');
const { setKeyProvider } = require('../src/security/keyProvider');
const { createLocalDevProvider } = require('../src/security/providers/localDev');
const { setProviderClientForTests } = require('../src/ai/providerFactory');

// End-to-end over HTTP (issue #104 acceptance criteria): upload -> encrypt
// -> process -> view -> delete, cross-user denial on every report route,
// download-token abuse, and consent enforcement.

let server;
let baseUrl;
let vaultDir;
let savedSecurity;
const users = {};

const CSV = 'Test,Value,Unit,Reference Range\nHemoglobin,13.5,g/dL,12-16\nGlucose,98,mg/dL,70-100\n';

async function createUser(name, provider = 'guest') {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ($1, $2) RETURNING *`, [provider, name]);
  return { user: rows[0], token: authService.signSession(rows[0]) };
}

async function call(who, method, url, { body, form, profileId, raw } = {}) {
  const headers = {};
  if (who) headers.Authorization = `Bearer ${who.token}`;
  if (profileId) headers['X-Profile-Id'] = profileId;
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${url}`, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function uploadForm(content, filename, type) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), filename);
  return form;
}

async function grant(who, type, granted = true, profileId) {
  return call(who, 'PUT', `/api/consents/${type}`, { body: { granted }, profileId });
}

function vaultFiles() {
  return fs.existsSync(vaultDir) ? fs.readdirSync(vaultDir) : [];
}

test.before(async () => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-http-'));
  savedSecurity = { ...config.security };
  config.security.encryptedStoreDir = vaultDir;
  setKeyProvider(createLocalDevProvider({ masterKeyHex: crypto.randomBytes(32).toString('hex'), nodeEnv: 'test' }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  users.a = await createUser('Security A');
  users.b = await createUser('Security B');
});

test.after(async () => {
  server.close();
  Object.assign(config.security, savedSecurity);
  setProviderClientForTests(null);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [Object.values(users).map((u) => u.user.id)]);
  fs.rmSync(vaultDir, { recursive: true, force: true });
  await pool.end();
});

test('upload needs storage consent, then stores ciphertext only', async (t) => {
  const refused = await call(users.a, 'POST', '/api/reports', { form: uploadForm(CSV, 'labs.csv', 'text/csv') });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'consent_required');
  assert.equal(vaultFiles().length, 0);

  const consents = await grant(users.a, 'medical_record_storage');
  assert.equal(consents.status, 200);
  assert.equal(consents.body.consents.find((c) => c.type === 'medical_record_storage').granted, true);

  const bad = await call(users.a, 'POST', '/api/reports', { form: uploadForm('just text', 'fake.pdf', 'application/pdf') });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'upload_rejected');

  const uploaded = await call(users.a, 'POST', '/api/reports', { form: uploadForm(CSV, 'labs.csv', 'text/csv') });
  assert.equal(uploaded.status, 201);
  const report = uploaded.body.report;
  users.a.reportId = report.id;
  assert.equal(report.encrypted, true);
  for (const hidden of ['storage_path', 'storage_object_key', 'encrypted_data_key', 'cipher_iv', 'cipher_auth_tag', 'key_reference']) {
    assert.ok(!(hidden in report), `${hidden} must not be returned`);
  }

  const files = vaultFiles();
  assert.equal(files.length, 1);
  const ciphertext = fs.readFileSync(path.join(vaultDir, files[0]));
  assert.ok(!ciphertext.includes(Buffer.from('Hemoglobin')));
  const { rows } = await pool.query('SELECT storage_path, encryption_version FROM reports WHERE id = $1', [report.id]);
  assert.equal(rows[0].storage_path, null);
  assert.equal(rows[0].encryption_version, 1);

  await t.test('processing decrypts in memory and extracts results', async () => {
    await realProcessReport(report.id);
    const detail = await call(users.a, 'GET', `/api/reports/${report.id}`);
    assert.equal(detail.body.report.ingestion_status, 'Needs Review');
    assert.ok(detail.body.measurements.some((m) => /Hemoglobin/.test(m.raw_test_name)));
    assert.equal(vaultFiles().length, 1, 'no extra files written');
  });

  await t.test('viewing decrypts only after authorization, with no-store headers', async () => {
    const link = await call(users.a, 'GET', `/api/reports/${report.id}/file-url`);
    assert.equal(link.status, 200);
    const res = await call(null, 'GET', link.body.url, { raw: true });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), CSV);
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
    assert.match(res.headers.get('content-disposition'), /filename="labs.csv"/);
  });
});

test('another user can never reach the report', async () => {
  const id = users.a.reportId;
  const b = users.b;
  assert.equal((await call(b, 'GET', `/api/reports/${id}`)).status, 404);
  assert.equal((await call(b, 'GET', `/api/reports/${id}/file-url`)).status, 404);
  assert.equal((await call(b, 'POST', `/api/reports/${id}/retry`)).status, 404);
  assert.equal((await call(b, 'PATCH', `/api/reports/${id}`, { body: { effective_date: '2026-01-01' } })).status, 404);
  assert.equal((await call(b, 'POST', `/api/reports/${id}/confirm`)).status, 404);
  assert.equal((await call(b, 'DELETE', `/api/reports/${id}`)).status, 404);
  const { rows } = await pool.query('SELECT id FROM health_measurements WHERE report_id = $1 LIMIT 1', [id]);
  assert.equal((await call(b, 'PATCH', `/api/reports/${id}/measurements/${rows[0].id}`, { body: { raw_value: '1' } })).status, 404);
  const list = await call(b, 'GET', '/api/reports');
  assert.ok(!list.body.reports.some((r) => r.id === id));
  // Acting as someone else's profile without a family link is refused.
  assert.equal((await call(b, 'GET', `/api/reports/${id}`, { profileId: users.a.user.id })).status, 403);

  const denied = await pool.query(`SELECT count(*)::int AS n FROM security_audit_events WHERE event_type = 'ACCESS_DENIED' AND report_id = $1`, [id]);
  assert.ok(denied.rows[0].n > 0);
});

test('download tokens cannot be forged, swapped, reused or outlive their report', async () => {
  const id = users.a.reportId;
  const other = await call(users.a, 'POST', '/api/reports', { form: uploadForm(CSV, 'second.csv', 'text/csv') });
  const otherId = other.body.report.id;

  const link = (await call(users.a, 'GET', `/api/reports/${id}/file-url`)).body.url;
  const token = new URL(link, baseUrl).searchParams.get('token');

  // Token for report A on report B's URL.
  assert.equal((await call(null, 'GET', `/api/files/report/${otherId}?token=${token}`)).status, 404);
  // A token minted for another user's id.
  const forged = authService.signReportDownloadToken({ userId: users.b.user.id, reportId: id });
  assert.equal((await call(null, 'GET', `/api/files/report/${id}?token=${forged}`)).status, 404);
  // A session token is not a download token.
  assert.equal((await call(null, 'GET', `/api/files/report/${id}?token=${users.a.token}`)).status, 404);
  // No token / garbage.
  assert.equal((await call(null, 'GET', `/api/files/report/${id}`)).status, 404);
  assert.equal((await call(null, 'GET', `/api/files/report/${id}?token=abc`)).status, 404);

  // Single-use mode.
  config.security.downloadTokenSingleUse = true;
  try {
    const once = (await call(users.a, 'GET', `/api/reports/${id}/file-url`)).body.url;
    assert.equal((await call(null, 'GET', once, { raw: true })).status, 200);
    assert.equal((await call(null, 'GET', once)).status, 410);
  } finally {
    config.security.downloadTokenSingleUse = false;
  }

  // Expiry.
  config.security.downloadTokenTtlSeconds = 1;
  try {
    const shortLived = (await call(users.a, 'GET', `/api/reports/${id}/file-url`)).body.url;
    await new Promise((r) => setTimeout(r, 2100));
    assert.equal((await call(null, 'GET', shortLived)).status, 404);
  } finally {
    config.security.downloadTokenTtlSeconds = savedSecurity.downloadTokenTtlSeconds;
  }

  // Permanent deletion removes the ciphertext; old links die with it.
  const before = vaultFiles().length;
  const stillValid = (await call(users.a, 'GET', `/api/reports/${otherId}/file-url`)).body.url;
  assert.equal((await call(users.a, 'DELETE', `/api/reports/${otherId}`)).status, 204);
  assert.equal(vaultFiles().length, before - 1);
  assert.equal((await call(null, 'GET', stillValid)).status, 404);
  const deleted = await pool.query(`SELECT count(*)::int AS n FROM security_audit_events WHERE event_type = 'REPORT_DELETED' AND report_id = $1`, [otherId]);
  assert.equal(deleted.rows[0].n, 1);
});

test('AI extraction runs only with AI consent; otherwise it stays local', async () => {
  const calls = [];
  setProviderClientForTests({
    messages: {
      create: async () => {
        calls.push('create');
        return { content: [] };
      },
      stream: () => ({
        finalMessage: async () => {
          calls.push('stream');
          return { content: [], stop_reason: 'end_turn' };
        },
      }),
    },
  });
  const savedProvider = config.extractionProvider;
  const savedKey = config.anthropicApiKey;
  config.extractionProvider = 'claude';
  config.anthropicApiKey = 'test-key';
  try {
    const noAi = await call(users.a, 'POST', '/api/reports', { form: uploadForm(CSV, 'local.csv', 'text/csv') });
    await realProcessReport(noAi.body.report.id);
    assert.equal(calls.length, 0, 'nothing sent to the AI provider without consent');
    const local = await call(users.a, 'GET', `/api/reports/${noAi.body.report.id}`);
    assert.ok(local.body.measurements.length > 0, 'local extraction still worked');

    await grant(users.a, 'ai_document_processing');
    const withAi = await call(users.a, 'POST', '/api/reports', { form: uploadForm(CSV, 'ai.csv', 'text/csv') });
    await realProcessReport(withAi.body.report.id);
    assert.equal(calls.length, 1, 'AI used once consent was given');

    await grant(users.a, 'ai_document_processing', false);
    await realProcessReport(withAi.body.report.id);
    assert.equal(calls.length, 1, 'revoking consent stops further AI processing');
    // Revoking AI consent never blocks viewing or deleting.
    assert.equal((await call(users.a, 'GET', `/api/reports/${withAi.body.report.id}/file-url`)).status, 200);
  } finally {
    config.extractionProvider = savedProvider;
    config.anthropicApiKey = savedKey;
  }
});

test('caregivers decide for managed profiles, never for another adult', async () => {
  const created = await call(users.a, 'POST', '/api/family/members', { body: { displayName: 'Dad', relation: 'father' } });
  const dadId = created.body.profile.id;
  users.dad = { user: { id: dadId } };
  const forDad = await grant(users.a, 'medical_record_storage', true, dadId);
  assert.equal(forDad.status, 200);
  assert.equal(forDad.body.subjectUserId, dadId);
  const { rows } = await pool.query('SELECT granted_by_user_id FROM user_consents WHERE user_id = $1', [dadId]);
  assert.equal(rows[0].granted_by_user_id, users.a.user.id);

  // A real account shared with A: A can view, not change, their consent.
  const invite = await call(users.b, 'POST', '/api/family/invites', { body: { access: 'manage' } });
  await call(users.a, 'POST', '/api/family/invites/redeem', { body: { code: invite.body.invite.code } });
  const view = await call(users.a, 'GET', '/api/consents', { profileId: users.b.user.id });
  assert.equal(view.body.canEdit, false);
  assert.equal((await grant(users.a, 'ai_health_insights', true, users.b.user.id)).status, 403);
});
