const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { fetchLatestUnmappedMeasurements } = require('../src/routes/dashboard');

// Regression test: /api/dashboard/custom-cards (backed by
// fetchLatestUnmappedMeasurements) used to additionally require
// hm.is_confirmed = true, unlike /api/dashboard/organs which shows a
// registry-mapped result from any report in 'Needs Review' or 'Completed'
// status. Since a report sits in 'Needs Review' until a person explicitly
// taps "Confirm report" - which they have no strong reason to do before
// they've reviewed it - an unmapped result could be invisible on the
// Dashboard indefinitely even though its mapped siblings from the same
// report already show up on an organ card. This proves an unmapped result
// from an unconfirmed report is found, matching /organs' own scoping.

let userId;
let reportId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('dashboard-customcards-test@example.com', 'Dashboard Test') RETURNING id`
  );
  userId = user.rows[0].id;

  const report = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status)
     VALUES ($1, 'unconfirmed.pdf', 'application/pdf', 'pdf', 10, '/tmp/unconfirmed.pdf', 'Needs Review')
     RETURNING id`,
    [userId]
  );
  reportId = report.rows[0].id;

  // Shaped exactly like a freshly-extracted, not-yet-confirmed, unmapped
  // result: health_parameter_id NULL, is_confirmed false (the DB default).
  await pool.query(
    `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, value_type, numeric_value)
     VALUES ($1, 'A/G Ratio', '1.4', 'numeric', 1.4)`,
    [reportId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('fetchLatestUnmappedMeasurements finds an unmapped result even before the report is confirmed', async () => {
  const rows = await fetchLatestUnmappedMeasurements(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw_test_name, 'A/G Ratio');
  assert.equal(rows[0].report_id, reportId);
});

test('fetchLatestUnmappedMeasurements ignores a report in an excluded status (e.g. Failed)', async () => {
  await pool.query(`UPDATE reports SET ingestion_status = 'Failed' WHERE id = $1`, [reportId]);
  try {
    const rows = await fetchLatestUnmappedMeasurements(userId);
    assert.equal(rows.length, 0);
  } finally {
    await pool.query(`UPDATE reports SET ingestion_status = 'Needs Review' WHERE id = $1`, [reportId]);
  }
});
