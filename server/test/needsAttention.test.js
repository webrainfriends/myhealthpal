const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const dashboardRoutes = require('../src/routes/dashboard');
const { fetchNeedsAttention } = dashboardRoutes;

// Regression tests for the "needs attention" list: it used to include every
// row flagged needs_review - normal urine "Absent" findings, a unit the
// registry hadn't heard of, blank template rows - while a genuinely low
// vitamin D could be crowded out of the list.

let userId;
let reportId;

async function addMeasurement({ code = null, name, value, unit = null, flag = null, range = null, qualitative = null, needsReview = false }) {
  let parameterId = null;
  if (code) {
    const p = await pool.query('SELECT id FROM health_parameters WHERE code = $1', [code]);
    parameterId = p.rows[0].id;
  }
  const numeric = qualitative ? null : Number(value);
  await pool.query(
    `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, raw_unit, value_type,
        numeric_value, normalized_value, qualitative_value, status_flag, reference_range_raw, needs_review)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)`,
    [reportId, parameterId, name, value, unit, qualitative ? 'qualitative' : 'numeric', numeric, qualitative, flag, range, needsReview]
  );
}

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('needs-attention-test@example.com', 'NA Test') RETURNING id`
  );
  userId = user.rows[0].id;
  const report = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
     VALUES ($1, 'x.pdf', 'application/pdf', 'pdf', 10, '/tmp/x.pdf', 'Needs Review', '2025-08-31') RETURNING id`,
    [userId]
  );
  reportId = report.rows[0].id;

  // Normal results that were flagged only because they need review.
  await addMeasurement({ code: 'egfr', name: 'eGFR', value: '117', unit: 'mL/min/1.73 m2', needsReview: true });
  await addMeasurement({ code: 'urine_bile', name: 'Bile Salts', value: 'Absent', qualitative: 'Absent', needsReview: true });
  // Unmapped template rows with no real result.
  await addMeasurement({ name: 'Trichomonas', value: 'Absent', qualitative: 'Absent', needsReview: true });
  await addMeasurement({ name: 'Some Blank Field', value: '-', qualitative: '-', needsReview: true });
  // Unmapped, but a real value a person should look at.
  await addMeasurement({ name: 'Mystery Marker', value: '12.5', unit: 'U/L', needsReview: true });
  // Genuinely abnormal.
  await addMeasurement({ code: 'vitamin_d', name: 'Vitamin D', value: '20.6', unit: 'ng/mL', range: '30-100', needsReview: true });
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('needs-attention lists real out-of-range results first and drops normal / template rows', async () => {
  const items = await fetchNeedsAttention(userId);
  const names = items.map((i) => i.raw_test_name);

  assert.equal(names[0], 'Vitamin D');
  assert.equal(items[0].attention_reason, 'abnormal');
  assert.equal(items[0].direction, 'low');
  assert.equal(items[0].unit, 'ng/mL');

  assert.ok(names.includes('Mystery Marker'));
  assert.equal(items.find((i) => i.raw_test_name === 'Mystery Marker').attention_reason, 'unmapped');

  for (const dropped of ['eGFR', 'Bile Salts', 'Trichomonas', 'Some Blank Field']) {
    assert.ok(!names.includes(dropped), `${dropped} should not need attention`);
  }
});

test('an unmapped test spelled two ways counts once, and old review-only leftovers are hidden', async () => {
  const user = await pool.query(`INSERT INTO users (email, display_name) VALUES ('needs-attention-stale@example.com', 'ST') RETURNING id`);
  const uid = user.rows[0].id;
  try {
    const mk = async (name, date) =>
      (
        await pool.query(
          `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status, effective_date)
           VALUES ($1, $2, 'application/pdf', 'pdf', 10, '/tmp/x', 'Needs Review', $3) RETURNING id`,
          [uid, name, date]
        )
      ).rows[0].id;
    const old = await mk('old.pdf', '2022-03-01');
    const recent = await mk('new.pdf', '2026-08-31');
    const ins = (report, name) =>
      pool.query(
        `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, raw_unit, value_type, numeric_value, needs_review) VALUES ($1, $2, '12', 'U/L', 'numeric', 12, true)`,
        [report, name]
      );
    await ins(old, 'A/G Ratio');
    await ins(old, 'Old Only Marker');
    await ins(recent, 'A/G  RATIO');
    const { items, counts } = await dashboardRoutes.fetchNeedsAttentionDetailed(uid);
    const names = items.map((i) => i.raw_test_name);
    assert.deepEqual(names, ['A/G  RATIO']);
    assert.equal(counts.staleHidden, 1);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
  }
});
