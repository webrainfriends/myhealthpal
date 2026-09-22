const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const {
  detectActivityTable,
  importActivityTable,
  importActivityTablesFrom,
} = require('../src/services/activityImportService');

let userId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('activity-import-test@example.com', 'Activity Import Test') RETURNING id`
  );
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM activity_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('detectActivityTable recognizes a MedM-style Activity sheet by its Steps + Date&Time columns', () => {
  const rows = [
    [
      'Medical Record ID',
      'Medical record email',
      'Name',
      'Gender',
      'Date of Birth',
      'ID',
      'Date & Time (Local Time)',
      'Duration',
      'Active Time',
      'Steps',
      'Climb',
      'Floors',
      'Distance',
      'Calories Burned',
      'Activity stream duration by type',
      'Feeling',
      'Note',
      'Source',
      'Client',
    ],
    [
      'mrid-1', 'a@b.com', 'Test User', 'F', '1990-01-01', '1',
      '2026-09-20', '15:40:00', '10:00:00', 9348, 5, 2, 6866, 1651, '', '', '', 'MedM', 'App',
    ],
  ];

  const columns = detectActivityTable(rows);
  assert.ok(columns, 'expected an activity-shaped table to be detected');
  assert.equal(rows[0][columns.stepsIndex].toLowerCase(), 'steps');
  assert.equal(rows[0][columns.dateIndex], 'Date & Time (Local Time)');
  assert.equal(rows[0][columns.caloriesIndex], 'Calories Burned');
  assert.equal(rows[0][columns.distanceIndex], 'Distance');
});

test('detectActivityTable returns null for an ordinary lab-result table (no Steps column)', () => {
  const rows = [
    ['Test Name', 'Date', 'Value', 'Unit', 'Reference Range'],
    ['Glucose', '2026-09-20', '129', 'mg/dL', '70-99'],
  ];
  assert.equal(detectActivityTable(rows), null);
});

test('detectActivityTable returns null for a table with Steps but no date column', () => {
  const rows = [
    ['Steps', 'Calories Burned'],
    [9348, 1651],
  ];
  assert.equal(detectActivityTable(rows), null);
});

test('importActivityTable upserts one activity_logs row per dated row, skipping rows with no usable date', async () => {
  const rows = [
    ['Date & Time (Local Time)', 'Steps', 'Calories Burned', 'Distance'],
    ['2026-01-05', 4000, 1500, 3000],
    ['not-a-date', 9999, 9999, 9999],
    ['2026-01-06', 8000, 1800, 6000],
  ];
  const columns = detectActivityTable(rows);
  const imported = await importActivityTable(userId, rows, columns);
  assert.equal(imported, 2);

  const { rows: stored } = await pool.query(
    'SELECT log_date, steps, calories_burned, distance_meters FROM activity_logs WHERE user_id = $1 ORDER BY log_date',
    [userId]
  );
  assert.equal(stored.length, 2);
  assert.equal(stored[0].steps, 4000);
  assert.equal(stored[0].calories_burned, 1500);
  assert.equal(Number(stored[0].distance_meters), 3000);
  assert.equal(stored[1].steps, 8000);
});

test('importActivityTable does not clobber an existing day\'s value with a null/missing column via COALESCE upsert', async () => {
  const stepsOnlyRows = [
    ['Date', 'Steps'],
    ['2026-02-01', 5000],
  ];
  await importActivityTable(userId, stepsOnlyRows, detectActivityTable(stepsOnlyRows));

  const caloriesOnlyRows = [
    ['Date', 'Steps', 'Calories Burned'],
    ['2026-02-01', '', 1200],
  ];
  await importActivityTable(userId, caloriesOnlyRows, detectActivityTable(caloriesOnlyRows));

  const { rows: stored } = await pool.query(
    'SELECT steps, calories_burned FROM activity_logs WHERE user_id = $1 AND log_date = $2',
    [userId, '2026-02-01']
  );
  assert.equal(stored[0].steps, 5000, 'steps from the first import must survive a later import missing that column');
  assert.equal(stored[0].calories_burned, 1200);
});

test('importActivityTablesFrom splits activity-shaped tables from clinical ones, importing only the former', async () => {
  const activityRows = [
    ['Date & Time (Local Time)', 'Steps', 'Calories Burned', 'Distance'],
    ['2026-03-01', 6000, 1600, 4500],
  ];
  const labRows = [
    ['Test Name', 'Date', 'Value', 'Unit', 'Reference Range'],
    ['Glucose', '2026-03-01', '129', 'mg/dL', '70-99'],
  ];

  const { remainingTables, importedDays } = await importActivityTablesFrom([activityRows, labRows], userId);
  assert.equal(importedDays, 1);
  assert.equal(remainingTables.length, 1);
  assert.deepEqual(remainingTables[0], labRows);

  const { rows: stored } = await pool.query(
    'SELECT steps FROM activity_logs WHERE user_id = $1 AND log_date = $2',
    [userId, '2026-03-01']
  );
  assert.equal(stored[0].steps, 6000);
});

test('importActivityTablesFrom is a no-op for a non-array (e.g. undefined) tables input', async () => {
  const result = await importActivityTablesFrom(undefined, userId);
  assert.equal(result.importedDays, 0);
  assert.equal(result.remainingTables, undefined);
});
