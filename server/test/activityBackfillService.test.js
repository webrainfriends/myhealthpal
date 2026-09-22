const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const pool = require('../src/db/pool');
const {
  findMisclassifiedActivityReportIds,
  backfillMisclassifiedActivityReports,
} = require('../src/services/activityBackfillService');

// Reproduces the exact failure mode this service exists to heal: a report
// processed by the pre-fix pipeline, which ran a wearable Activity sheet
// through the generic clinical extractor and left Steps/Distance/Calories
// Burned sitting in health_measurements as unmapped "needs review" results,
// never reaching activity_logs. That's simulated directly here (rather than
// by running the old buggy code, which no longer exists) by hand-inserting
// health_measurements rows shaped exactly like that old code would have
// produced, pointed at a real Activity-shaped xlsx file on disk so
// reprocessing has real data to import.

let userId;
let reportId;
let filePath;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('activity-backfill-test@example.com', 'Activity Backfill Test') RETURNING id`
  );
  userId = user.rows[0].id;

  filePath = path.join(os.tmpdir(), `activity-backfill-test-${Date.now()}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Activity');
  sheet.addRow(['Date & Time (Local Time)', 'Steps', 'Calories Burned', 'Distance']);
  sheet.addRow(['2026-04-01', 7000, 1700, 5200]);
  sheet.addRow(['2026-04-02', 8500, 1900, 6300]);
  await workbook.xlsx.writeFile(filePath);

  const report = await pool.query(
    `INSERT INTO reports
       (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status)
     VALUES ($1, 'legacy-activity-export.xlsx',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 1000, $2, 'Needs Review')
     RETURNING id`,
    [userId, filePath]
  );
  reportId = report.rows[0].id;

  // Shaped like the pre-fix wide-table extractor's output: unmapped
  // (health_parameter_id NULL), not confirmed, raw_test_name taken verbatim
  // from the sheet's header row.
  for (const [rawTestName, rawValue] of [
    ['Steps', '7000'],
    ['Calories Burned', '1700'],
    ['Distance', '5200'],
  ]) {
    await pool.query(
      `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, value_type, numeric_value, needs_review)
       VALUES ($1, $2, $3, 'numeric', $4, true)`,
      [reportId, rawTestName, rawValue, Number(rawValue)]
    );
  }
});

test.after(async () => {
  await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
  require('node:fs').unlinkSync(filePath);
});

test('findMisclassifiedActivityReportIds finds the legacy report by its fitness-only raw test names', async () => {
  const ids = await findMisclassifiedActivityReportIds();
  assert.ok(ids.includes(reportId), 'expected the seeded legacy report to be found');
});

test('backfillMisclassifiedActivityReports reprocesses the legacy report: clears the junk measurements and imports into activity_logs', async () => {
  const count = await backfillMisclassifiedActivityReports();
  assert.ok(count >= 1, 'expected at least the seeded report to be backfilled');

  const { rows: measurementsAfter } = await pool.query(
    'SELECT raw_test_name FROM health_measurements WHERE report_id = $1',
    [reportId]
  );
  assert.equal(
    measurementsAfter.length,
    0,
    `expected the junk measurements to be cleared, found: ${JSON.stringify(measurementsAfter)}`
  );

  const { rows: logs } = await pool.query(
    'SELECT log_date, steps, calories_burned, distance_meters FROM activity_logs WHERE user_id = $1 ORDER BY log_date',
    [userId]
  );
  assert.equal(logs.length, 2);
  assert.equal(logs[0].steps, 7000);
  assert.equal(logs[0].calories_burned, 1700);
  assert.equal(Number(logs[0].distance_meters), 5200);
  assert.equal(logs[1].steps, 8500);

  // Re-running the backfill must be a no-op now that the report is clean -
  // it should never keep reprocessing the same report forever.
  const idsAfter = await findMisclassifiedActivityReportIds();
  assert.ok(!idsAfter.includes(reportId));
});
