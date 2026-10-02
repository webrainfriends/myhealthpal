const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const dashboardRoutes = require('../src/routes/dashboard');
const { latestResults } = require('../src/services/latestResults');
const { tokenKey } = require('../src/extraction/registry');

// "Current result per test" is one definition shared by the organ cards, the
// custom cards and the needs-attention list: these tests drive all three
// from the same data so they can't drift apart again.

async function withUser(email, fn) {
  const uid = (await pool.query(`INSERT INTO users (email, display_name) VALUES ($1, 'T') RETURNING id`, [email])).rows[0].id;
  const mkReport = async (name, date) =>
    (
      await pool.query(
        `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
         VALUES ($1, $2, 'application/pdf', 'pdf', 10, '/tmp/x', 'Needs Review', $3) RETURNING id`,
        [uid, name, date]
      )
    ).rows[0].id;
  const add = async (reportId, { code = null, name, value, unit = null, flag = null, range = null, review = false }) => {
    const parameterId = code ? (await pool.query('SELECT id FROM health_parameters WHERE code = $1', [code])).rows[0].id : null;
    await pool.query(
      `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, raw_unit, value_type, numeric_value,
         normalized_value, status_flag, reference_range_raw, needs_review)
       VALUES ($1, $2, $3, $4, $5, 'numeric', $6, $6, $7, $8, $9)`,
      [reportId, parameterId, name, String(value), unit, Number(value), flag, range, review]
    );
  };
  try {
    await fn({ uid, mkReport, add });
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  }
}

test.after(() => pool.end());

test('tokenKey ignores order and punctuation but keeps words that change the test', () => {
  assert.equal(tokenKey('Cholesterol - HDL'), tokenKey('HDL Cholesterol'));
  assert.equal(tokenKey('TC/HDL Ratio'), tokenKey('Cholesterol / HDL ratio'));
  assert.equal(tokenKey('Total Leucocyte Count'), tokenKey('WBC Count'));
  assert.notEqual(tokenKey('Direct Bilirubin'), tokenKey('Total Bilirubin'));
  assert.notEqual(tokenKey('TC/HDL'), tokenKey('HDL Cholesterol'));
  assert.notEqual(tokenKey('AST'), tokenKey('AST/ALT'));
});

test('organ cards, custom cards and needs-attention all use the newest result, not an old undated or unmapped one', async () => {
  await withUser('latest-results-all@example.com', async ({ uid, mkReport, add }) => {
    const oldUndated = await mkReport('old-undated.pdf', null); // uploaded later than the real panel
    const old2022 = await mkReport('old2022.pdf', '2022-03-01');
    const panel = await mkReport('panel.pdf', '2026-08-31');

    await add(oldUndated, { code: 'hemoglobin', name: 'Hemoglobin', value: 9, flag: 'Low', range: '13-17' });
    await add(old2022, { name: 'Cholesterol - HDL', value: 38.7, flag: 'Low', range: '40-60', review: true });
    await add(old2022, { name: 'Some Obsolete Marker', value: 7, flag: 'High', range: '0-5', review: true });
    await add(panel, { code: 'hemoglobin', name: 'Hemoglobin', value: 14.2, flag: 'Normal', range: '13-17' });
    await add(panel, { code: 'hdl_cholesterol', name: 'HDL Cholesterol', value: 48, flag: 'Normal', range: '40-60' });

    // needs attention: nothing - every current result is in range
    const attention = await dashboardRoutes.fetchNeedsAttentionDetailed(uid);
    assert.deepEqual(attention.items, []);

    // organ cards: nothing out of range (the old low haemoglobin / HDL are gone)
    const { organs } = await dashboardRoutes.buildOrgans(uid, 'en');
    const outOfRange = organs.flatMap((o) => (o.outOfRange || []).map((p) => p.code));
    assert.deepEqual(outOfRange, []);
    const blood = organs.find((o) => o.key === 'blood');
    assert.equal(blood.parameters.find((p) => p.code === 'hemoglobin').value, '14.2');

    // custom cards: the 2022 unmapped leftover is more than a year older than the panel
    assert.deepEqual(await dashboardRoutes.fetchLatestUnmappedMeasurements(uid), []);
  });
});

test('the same figure printed under two names in one report is listed once', async () => {
  await withUser('latest-results-twice@example.com', async ({ uid, mkReport, add }) => {
    const r = await mkReport('r.pdf', '2022-05-01');
    await add(r, { code: 'wbc', name: 'WBC Count', value: 11.1, unit: '10^3/uL', flag: 'High', range: '4-10' });
    await add(r, { name: 'Total Leukocytes', value: 11.1, unit: '10^3/uL', flag: 'High', range: '4-10', review: true });
    const { rows } = await latestResults(uid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code, 'wbc');
  });
});

test('a lab\'s printed scale is kept alongside the standard range, and a diagnostic cutoff is named', async () => {
  await withUser('latest-results-hba1c@example.com', async ({ uid, mkReport, add }) => {
    const r = await mkReport('r.pdf', '2026-08-31');
    const scale = 'Non-Diabetic Level: < 5.7% Pre Diabetic 5.7-6.4% Diabetic Level: >=6.5% Goal 7.0%';
    await add(r, { code: 'hba1c', name: 'HbA1c', value: 6.8, unit: '%', range: scale });
    const { items } = await dashboardRoutes.fetchNeedsAttentionDetailed(uid);
    const item = items[0];
    assert.equal(item.reference_range, scale); // what the lab printed
    assert.equal(item.reference_source, 'standard'); // what the verdict was judged against
    assert.match(item.standard_range, /^\d+(\.\d+)?-\d+(\.\d+)?$/);
    assert.equal(item.diagnostic_cutoff, 6.5);
    assert.equal(item.severity, 'marked');
  });
});

test('needs_review on an item means a person must look; the stored confidence flag is kept apart', async () => {
  await withUser('latest-results-review@example.com', async ({ uid, mkReport, add }) => {
    const r = await mkReport('r.pdf', '2026-08-31');
    await add(r, { code: 'hemoglobin', name: 'Hemoglobin', value: 9, flag: 'Low', range: '13-17', review: true });
    const { items } = await dashboardRoutes.fetchNeedsAttentionDetailed(uid);
    assert.equal(items[0].attention_reason, 'abnormal');
    assert.equal(items[0].needs_review, false);
    assert.equal(items[0].low_confidence, true);
  });
});
