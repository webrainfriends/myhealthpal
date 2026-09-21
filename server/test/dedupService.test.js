const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const dedupService = require('../src/extraction/dedupService');

// Most real-world lab PDFs print a result as a bare "Name Value Unit Range"
// line with no per-line date, so a measurement's own sample_datetime is
// null far more often than not - this suite exists specifically to prove
// dedup still catches "the same report re-uploaded" in that (common) case,
// via the report's own effective_date, not just when a per-row date exists.

let userId;
let parameterId;
let reportAId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('dedup-test@example.com', 'Dedup Test') RETURNING id`
  );
  userId = user.rows[0].id;

  const parameter = await pool.query(
    `INSERT INTO health_parameters (code, display_name, category, data_type, canonical_unit)
     VALUES ('dedup_test_param', 'Dedup Test Param', 'metabolic', 'numeric', 'mg/dL') RETURNING id`
  );
  parameterId = parameter.rows[0].id;

  const reportA = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, effective_date)
     VALUES ($1, 'report-a.pdf', 'application/pdf', 'pdf', 10, '/tmp/report-a.pdf', '2026-09-01') RETURNING id`,
    [userId]
  );
  reportAId = reportA.rows[0].id;

  await pool.query(
    `INSERT INTO health_measurements
       (report_id, health_parameter_id, raw_test_name, raw_value, value_type, numeric_value, normalized_value)
     VALUES ($1, $2, 'Dedup Test Param', '99', 'numeric', 99, 99)`,
    [reportAId, parameterId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.query('DELETE FROM health_parameters WHERE id = $1', [parameterId]);
  await pool.end();
});

async function insertReport(effectiveDate) {
  const { rows } = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, effective_date)
     VALUES ($1, 'report-b.pdf', 'application/pdf', 'pdf', 10, '/tmp/report-b.pdf', $2) RETURNING id`,
    [userId, effectiveDate]
  );
  return rows[0].id;
}

async function insertMeasurement(reportId, value, sampleDatetime = null) {
  const { rows } = await pool.query(
    `INSERT INTO health_measurements
       (report_id, health_parameter_id, raw_test_name, raw_value, value_type, numeric_value, normalized_value, sample_datetime)
     VALUES ($1, $2, 'Dedup Test Param', $3, 'numeric', $4, $4, $5) RETURNING id, duplicate_status`,
    [reportId, parameterId, String(value), value, sampleDatetime]
  );
  return rows[0];
}

test('findDuplicate matches same parameter/day/value from a different report via the day param', async () => {
  const reportBId = await insertReport('2026-09-01');
  const measurement = await insertMeasurement(reportBId, 99);

  const duplicate = await dedupService.findDuplicate({
    userId,
    reportId: reportBId,
    parameterId,
    day: '2026-09-01',
    numericValue: 99,
    normalizedValue: 99,
    qualitativeValue: null,
  });

  assert.ok(duplicate, 'expected a duplicate match');
  assert.equal(duplicate.report_id, reportAId);

  await pool.query('DELETE FROM health_measurements WHERE id = $1', [measurement.id]);
  await pool.query('DELETE FROM reports WHERE id = $1', [reportBId]);
});

test('findDuplicate does not match a different value on the same day', async () => {
  const reportBId = await insertReport('2026-09-01');

  const duplicate = await dedupService.findDuplicate({
    userId,
    reportId: reportBId,
    parameterId,
    day: '2026-09-01',
    numericValue: 55,
    normalizedValue: 55,
    qualitativeValue: null,
  });

  assert.equal(duplicate, null);
  await pool.query('DELETE FROM reports WHERE id = $1', [reportBId]);
});

test('reconcileMeasurementDuplicatesForReport flags a same-day/same-value measurement that had no per-row date of its own', async () => {
  // This is the realistic case: the measurement itself carries no
  // sample_datetime (a plain "Name Value Unit Range" line), so only the
  // report's own effective_date - known only *after* extraction - can
  // supply the day to check against.
  const reportBId = await insertReport('2026-09-01');
  const measurement = await insertMeasurement(reportBId, 99, null);
  assert.equal(measurement.duplicate_status, 'none');

  const flaggedCount = await dedupService.reconcileMeasurementDuplicatesForReport({
    userId,
    reportId: reportBId,
    effectiveDate: '2026-09-01',
  });

  assert.equal(flaggedCount, 1);
  const { rows } = await pool.query('SELECT duplicate_status, duplicate_of_id FROM health_measurements WHERE id = $1', [
    measurement.id,
  ]);
  assert.equal(rows[0].duplicate_status, 'suspected');
  assert.ok(rows[0].duplicate_of_id);

  await pool.query('DELETE FROM health_measurements WHERE id = $1', [measurement.id]);
  await pool.query('DELETE FROM reports WHERE id = $1', [reportBId]);
});

test('reconcileMeasurementDuplicatesForReport never re-flags a measurement someone already reviewed', async () => {
  const reportBId = await insertReport('2026-09-01');
  const measurement = await insertMeasurement(reportBId, 99, null);
  await pool.query(`UPDATE health_measurements SET duplicate_status = 'confirmed_distinct' WHERE id = $1`, [measurement.id]);

  await dedupService.reconcileMeasurementDuplicatesForReport({ userId, reportId: reportBId, effectiveDate: '2026-09-01' });

  const { rows } = await pool.query('SELECT duplicate_status FROM health_measurements WHERE id = $1', [measurement.id]);
  assert.equal(rows[0].duplicate_status, 'confirmed_distinct');

  await pool.query('DELETE FROM health_measurements WHERE id = $1', [measurement.id]);
  await pool.query('DELETE FROM reports WHERE id = $1', [reportBId]);
});
