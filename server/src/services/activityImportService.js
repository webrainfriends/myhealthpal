const pool = require('../db/pool');
const { normalizeHeader, parseNumeric, parseDate } = require('./parameterExtractor');

// Recognizes a wearable/health-tracker "Activity" export (seen from MedM
// Health; likely shared by similarly-structured Apple Health/Google
// Fit/Samsung Health aggregator exports) by its column signature, and
// imports it straight into activity_logs - never as health_measurements.
// Physical activity has no clinical reference range and is never
// "abnormal" (see activity_logs's own migration comment and
// organHealthService.js) - the wide-table extractor's generic
// column-as-test-name heuristic would otherwise treat every numeric column
// here (Steps, Distance, Calories Burned, and even a bare "15" parsed from
// a "15:40:00" Duration string) as an unmapped clinical result needing
// review, which is exactly what cluttered "Needs attention" with fitness
// data that was never a lab result.
const STEPS_HEADERS = new Set(['steps']);
const CALORIES_HEADERS = new Set(['calories burned', 'calories burnt', 'calories']);
const DISTANCE_HEADERS = new Set(['distance', 'distance (m)', 'distance meters']);
const DATE_HEADERS_EXCLUDE = new Set(['date of birth', 'dob']);

// `rows` is one sheet/table as produced by an adapter (array of arrays, row
// 0 is the header). Returns the column indexes to import if this table
// looks like an activity export (requires at least a date and a steps
// column - the two conditions the ingestion pipeline actually reads),
// else null so the caller leaves the table untouched for normal extraction.
function detectActivityTable(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const header = rows[0].map((h) => normalizeHeader(h));

  const stepsIndex = header.findIndex((h) => STEPS_HEADERS.has(h));
  if (stepsIndex === -1) return null;

  let dateIndex = header.findIndex((h) => h.includes('time') && !DATE_HEADERS_EXCLUDE.has(h));
  if (dateIndex === -1) dateIndex = header.findIndex((h) => h.includes('date') && !DATE_HEADERS_EXCLUDE.has(h));
  if (dateIndex === -1) return null;

  const caloriesIndex = header.findIndex((h) => CALORIES_HEADERS.has(h));
  const distanceIndex = header.findIndex((h) => DISTANCE_HEADERS.has(h));

  return { dateIndex, stepsIndex, caloriesIndex, distanceIndex };
}

// Upserts one activity_logs row per data row in the table, keyed by day -
// COALESCE means a column this table doesn't have (or a blank cell) never
// wipes out a value already logged for that day from another source (a
// manual entry, or a different export uploaded earlier).
async function importActivityTable(userId, rows, columns) {
  const { dateIndex, stepsIndex, caloriesIndex, distanceIndex } = columns;
  let importedDays = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const logDate = parseDate(row[dateIndex]);
    if (!logDate) continue;

    const steps = parseNumeric(row[stepsIndex]);
    const calories = caloriesIndex >= 0 ? parseNumeric(row[caloriesIndex]) : null;
    const distance = distanceIndex >= 0 ? parseNumeric(row[distanceIndex]) : null;
    if (steps === null && calories === null && distance === null) continue;

    await pool.query(
      `INSERT INTO activity_logs (user_id, log_date, steps, calories_burned, distance_meters)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, log_date) DO UPDATE SET
         steps = COALESCE(EXCLUDED.steps, activity_logs.steps),
         calories_burned = COALESCE(EXCLUDED.calories_burned, activity_logs.calories_burned),
         distance_meters = COALESCE(EXCLUDED.distance_meters, activity_logs.distance_meters),
         updated_at = now()`,
      [userId, logDate, steps, calories === null ? null : Math.round(calories), distance]
    );
    importedDays += 1;
  }

  return importedDays;
}

// Scans every table an adapter produced from a structured (XLSX/CSV)
// upload, imports any that look like an activity export, and returns the
// remaining tables (for normal extraction) plus how many days were
// imported in total. A no-op (returns `tables` unchanged, importedDays: 0)
// for a document with no structured tables at all, or none shaped like an
// activity export - callers don't need to branch on that themselves.
async function importActivityTablesFrom(tables, userId) {
  if (!Array.isArray(tables)) return { remainingTables: tables, importedDays: 0 };

  const remainingTables = [];
  let importedDays = 0;

  for (const rows of tables) {
    const columns = detectActivityTable(rows);
    if (columns) {
      importedDays += await importActivityTable(userId, rows, columns);
    } else {
      remainingTables.push(rows);
    }
  }

  return { remainingTables, importedDays };
}

module.exports = { detectActivityTable, importActivityTable, importActivityTablesFrom };
