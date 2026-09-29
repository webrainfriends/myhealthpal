const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { detectGlucoseTable, importGlucoseTablesFrom, parseMeasuredAt, toMgDl } = require('../src/services/glucoseImportService');
const { summarizeGlucose, estimatedAverageFromHba1c } = require('../src/services/glucoseSummaryService');

let userId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('glucose-import-test@example.com', 'Glucose Import Test') RETURNING id`
  );
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

const HEADER = ['Name', 'Date of Birth', 'ID', 'Date & Time (Local Time)', 'Glucose', 'Glucose Units', 'Feeling', 'Meal', 'Source'];
const table = () => [
  HEADER,
  ['A', 'February 01, 1978', '1', '2026-09-29 18:22:11', 92, 'mg/dL', '', 'Before Meal', 'Accu-Chek'],
  ['A', 'February 01, 1978', '2', '2026-09-29 08:12:52', 137, 'mg/dL', '', 'Fasting', 'Accu-Chek'],
  ['A', 'February 01, 1978', '3', '2026-09-27 10:14:27', 7.0, 'mmol/L', '', 'After Meal', 'Accu-Chek'],
  ['A', 'February 01, 1978', '4', 'not a date', 100, 'mg/dL', '', '', ''],
];

test('detectGlucoseTable needs a bare Glucose column and a date/time column', () => {
  const columns = detectGlucoseTable(table());
  assert.equal(columns.glucoseIndex, 4);
  assert.equal(columns.dateIndex, 3);
  assert.equal(detectGlucoseTable([['Test', 'Result'], ['Glucose', 90]]), null);
  assert.equal(detectGlucoseTable([['Glucose', 'Note'], [90, 'x']]), null);
});

test('parseMeasuredAt keeps the wall-clock time and rejects non-dates', () => {
  assert.equal(parseMeasuredAt('2026-09-29 18:22:11'), '2026-09-29 18:22:11');
  assert.equal(parseMeasuredAt('2026-09-29T08:05'), '2026-09-29 08:05:00');
  assert.equal(parseMeasuredAt('2026-09-29'), '2026-09-29 00:00:00');
  assert.equal(parseMeasuredAt('nope'), null);
});

test('toMgDl converts mmol/L and rejects non-positive values', () => {
  assert.equal(toMgDl(7, 'mmol/L'), 126.1);
  assert.equal(toMgDl(120, 'mg/dL'), 120);
  assert.equal(toMgDl(0, 'mg/dL'), null);
  assert.equal(toMgDl('abc', 'mg/dL'), null);
});

test('importGlucoseTablesFrom stores each reading once and leaves other tables alone', async () => {
  const other = [['Test', 'Result'], ['Hemoglobin', 14]];
  const first = await importGlucoseTablesFrom([table(), other], userId);
  assert.equal(first.importedReadings, 3);
  assert.equal(first.detectedTables, 1);
  assert.deepEqual(first.remainingTables, [other]);

  const again = await importGlucoseTablesFrom([table()], userId);
  assert.equal(again.importedReadings, 0, 're-uploading must not double-count');
  assert.equal(again.detectedTables, 1);

  const { rows } = await pool.query(
    `SELECT to_char(measured_at, 'YYYY-MM-DD HH24:MI:SS') AS at, value_mg_dl, meal_context
     FROM glucose_readings WHERE user_id = $1 ORDER BY measured_at`,
    [userId]
  );
  assert.deepEqual(rows.map((r) => r.at), ['2026-09-27 10:14:27', '2026-09-29 08:12:52', '2026-09-29 18:22:11']);
  assert.equal(Number(rows[0].value_mg_dl), 126.1);
});

test('summarizeGlucose averages per day and compares with the last lab report', () => {
  const readings = [
    { day: '2026-09-29', time: '08:12', value: 137, mealContext: 'Fasting' },
    { day: '2026-09-29', time: '18:22', value: 93, mealContext: 'Before Meal' },
    { day: '2026-09-27', time: '10:14', value: 200, mealContext: 'After Meal' },
  ];
  const s = summarizeGlucose(readings, {
    hba1c: { value: 6.8, date: '2026-08-01', reportId: 'r1' },
    glucose_fasting: { value: 118, date: '2026-08-01', reportId: 'r1' },
  });

  assert.equal(estimatedAverageFromHba1c(6.8), 148);
  assert.deepEqual(s.days.map((d) => d.date), ['2026-09-29', '2026-09-27']);
  const today = s.days[0];
  assert.equal(today.average, 115);
  assert.equal(today.count, 2);
  assert.equal(today.fastingAverage, 137);
  assert.equal(today.vsLabAverage.diff, -33);
  assert.equal(today.vsLabAverage.direction, 'below');
  assert.equal(today.vsLabFasting.direction, 'above');
  assert.equal(s.days[1].band, 'high');
  assert.equal(s.overall.inRangePercent, 67);
  assert.equal(s.lab.average.basis, 'hba1c');
});

test('summarizeGlucose with no lab report has no comparison, and no readings is empty', () => {
  const s = summarizeGlucose([{ day: '2026-09-29', time: '08:00', value: 100, mealContext: null }], {});
  assert.equal(s.days[0].vsLabAverage, null);
  assert.equal(s.lab.average, null);
  const empty = summarizeGlucose([], {});
  assert.equal(empty.overall, null);
  assert.equal(empty.days.length, 0);
});
