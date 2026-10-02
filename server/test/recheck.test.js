const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const ingestionService = require('../src/services/ingestionService');

// The retry route enqueues background processing; it must never run here.
let enqueued = 0;
ingestionService.enqueueProcessing = () => {
  enqueued += 1;
};

const app = require('../src/app');
const authService = require('../src/services/authService');
const { recheckReport } = require('../src/services/recheckService');
const { ServiceError } = require('../src/lib/serviceError');

let server;
let baseUrl;
const made = [];

async function createUser(name) {
  const { rows } = await pool.query(`INSERT INTO users (auth_provider, display_name) VALUES ('guest', $1) RETURNING *`, [name]);
  made.push(rows[0].id);
  return { user: rows[0], token: authService.signSession(rows[0]) };
}

async function mkReport(userId, { status = 'Completed', summary = null } = {}) {
  return (
    await pool.query(
      `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date, generated_summary)
       VALUES ($1, 'r.pdf', 'application/pdf', 'pdf', 1, '/tmp/r', $2, '2026-08-31', $3) RETURNING id`,
      [userId, status, summary]
    )
  ).rows[0].id;
}

async function addRow(reportId, name, value, unit, extra = {}) {
  const { rows } = await pool.query(
    `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, raw_unit, value_type, numeric_value, needs_review,
        extraction_confidence, is_confirmed, status_flag, reference_range_raw)
     VALUES ($1, $2, $3, $4, 'numeric', $5, true, 0.9, $6, $7, $8) RETURNING id`,
    [reportId, name, String(value), unit, Number(value), extra.confirmed ?? true, extra.flag ?? null, extra.range ?? null]
  );
  return rows[0].id;
}

const row = async (id) => (await pool.query('SELECT * FROM health_measurements WHERE id = $1', [id])).rows[0];

async function call(who, method, url) {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: who ? { Authorization: `Bearer ${who.token}` } : {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const id of made) await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await pool.end();
});

test('re-check fixes this report\'s stale results, leaves edited rows, other reports and the status alone', async () => {
  const owner = await createUser('Recheck Owner');
  const uid = owner.user.id;
  const target = await mkReport(uid, { summary: 'Extracted 3 health parameters. 16 flagged outside the reference range: stale. 13 values need manual review.' });
  const other = await mkReport(uid);

  const ratio = await addRow(target, 'AST/ALT Ratio (SGOT/SGPT)', 1.2, '%'); // stored unmapped (ambiguous), stray unit
  const platelets = await addRow(target, 'Platelet Count', 2.5, 'lakhs/cumm'); // never converted
  const edited = await addRow(target, 'TC/HDL Ratio', 3.9, null); // a person already fixed this one
  await pool.query(
    `INSERT INTO measurement_corrections (measurement_id, field_name, previous_value, new_value, corrected_by) VALUES ($1, 'raw_value', '3.8', '3.9', $2)`,
    [edited, uid]
  );
  const elsewhere = await addRow(other, 'Platelet Count', 2.5, 'lakhs/cumm'); // stale too, but another report

  const result = await recheckReport(uid, target);

  assert.equal(result.report.status, 'Completed');
  assert.ok(result.stats.updated >= 2);
  assert.equal(result.stats.skippedEdited, 1);
  assert.ok((await row(ratio)).health_parameter_id);
  assert.equal((await row(ratio)).normalized_unit, null);
  assert.equal(Number((await row(platelets)).normalized_value), 250);
  assert.equal((await row(edited)).health_parameter_id, null);
  assert.equal((await row(elsewhere)).normalized_unit, null); // untouched
  assert.equal((await row(platelets)).is_confirmed, true);

  assert.doesNotMatch(result.report.summary, /stale|13 values/);
  assert.match(result.report.summary, /^Extracted 3 health parameters\./);
  assert.equal(typeof result.counts.outOfRange, 'number');
  assert.equal(typeof result.dashboard.outOfRange, 'number');

  const status = (await pool.query('SELECT ingestion_status, generated_summary FROM reports WHERE id = $1', [target])).rows[0];
  assert.equal(status.ingestion_status, 'Completed');
  assert.equal(status.generated_summary, result.report.summary);

  const again = await recheckReport(uid, target);
  assert.equal(again.stats.updated, 0);
});

test('re-check refuses reports that are processing or have nothing to re-check, and other people\'s reports', async () => {
  const a = await createUser('Recheck A');
  const b = await createUser('Recheck B');
  const processing = await mkReport(a.user.id, { status: 'Processing' });
  await addRow(processing, 'Hemoglobin', 9, 'g/dL');
  const empty = await mkReport(a.user.id);
  const mine = await mkReport(a.user.id);
  await addRow(mine, 'Hemoglobin', 9, 'g/dL');

  await assert.rejects(recheckReport(a.user.id, processing), (e) => e instanceof ServiceError && e.status === 409);
  await assert.rejects(recheckReport(a.user.id, empty), (e) => e instanceof ServiceError && e.status === 409);
  await assert.rejects(recheckReport(b.user.id, mine), (e) => e instanceof ServiceError && e.status === 404);

  assert.equal((await call(b, 'POST', `/api/reports/${mine}/recheck`)).status, 404);
  assert.equal((await call(null, 'POST', `/api/reports/${mine}/recheck`)).status, 401);
  assert.equal((await call(a, 'POST', `/api/reports/${processing}/recheck`)).status, 409);
});

test('the HTTP route returns the report and dashboard counts', async () => {
  const owner = await createUser('Recheck HTTP');
  const rid = await mkReport(owner.user.id);
  await addRow(rid, 'Hemoglobin', 9, 'g/dL', { flag: 'Low', range: '13-17' });
  const res = await call(owner, 'POST', `/api/reports/${rid}/recheck`);
  assert.equal(res.status, 200);
  assert.equal(res.body.report.id, rid);
  assert.equal(res.body.counts.outOfRange, 1);
  assert.ok(res.body.dashboard.outOfRange >= 1);
});

test('two overlapping re-checks of one report: the second is refused', async () => {
  const owner = await createUser('Recheck Overlap');
  const rid = await mkReport(owner.user.id);
  await addRow(rid, 'Hemoglobin', 9, 'g/dL');
  const [first, second] = await Promise.allSettled([recheckReport(owner.user.id, rid), recheckReport(owner.user.id, rid)]);
  const outcomes = [first, second].map((r) => r.status);
  assert.equal(outcomes.filter((s) => s === 'fulfilled').length, 1);
  const rejected = [first, second].find((r) => r.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
});

test('retrying a confirmed report is refused (it would duplicate every result); an unconfirmed one still queues', async () => {
  const owner = await createUser('Recheck Retry');
  const confirmed = await mkReport(owner.user.id, { status: 'Completed' });
  const unconfirmed = await mkReport(owner.user.id, { status: 'Needs Review' });
  const before = enqueued;
  const refused = await call(owner, 'POST', `/api/reports/${confirmed}/retry`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Re-check results/);
  assert.equal(enqueued, before);
  const queued = await call(owner, 'POST', `/api/reports/${unconfirmed}/retry`);
  assert.equal(queued.status, 200);
  assert.equal(enqueued, before + 1);
});
