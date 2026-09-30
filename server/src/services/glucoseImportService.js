const pool = require('../db/pool');
const { normalizeHeader, parseNumeric } = require('./parameterExtractor');

// Recognizes a home glucometer export (MedM Health / Accu-Chek "Blood
// Glucose" sheet: one row per reading with a local date & time, the value,
// its unit and a meal context) by its column signature, and imports each
// row into glucose_readings - never as health_measurements. Going through
// the generic wide-table extractor collapsed the whole sheet to a single
// "latest Glucose" result, which is why the diabetes card showed one number
// and none of the readings behind it. A lab-drawn glucose test is a
// different clinical entity (see the registry's `glucose` entry), so the
// two are deliberately kept apart and compared on the diabetes card instead.
const MMOL_TO_MGDL = 18.0182;
const DATE_HEADERS_EXCLUDE = new Set(['date of birth', 'dob']);

// Returns the column indexes to import if this table looks like a glucometer
// export (needs a bare "Glucose" column plus a date/time column - the two
// things a reading can't exist without), else null so the caller leaves the
// table for normal extraction.
function detectGlucoseTable(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const header = rows[0].map((h) => normalizeHeader(h));

  const glucoseIndex = header.findIndex((h) => h === 'glucose');
  if (glucoseIndex === -1) return null;

  let dateIndex = header.findIndex((h) => h.includes('time') && !DATE_HEADERS_EXCLUDE.has(h));
  if (dateIndex === -1) dateIndex = header.findIndex((h) => h.includes('date') && !DATE_HEADERS_EXCLUDE.has(h));
  if (dateIndex === -1) return null;

  return {
    dateIndex,
    glucoseIndex,
    unitIndex: header.findIndex((h) => h === 'glucose units' || h === 'unit' || h === 'units'),
    mealIndex: header.findIndex((h) => h === 'meal' || h === 'meal context'),
    sourceIndex: header.findIndex((h) => h === 'source'),
    feelingIndex: header.findIndex((h) => h === 'feeling' || h === 'mood'),
    hematocritIndex: header.findIndex((h) => h === 'hematocrit' || h === 'hct'),
    noteIndex: header.findIndex((h) => h === 'note' || h === 'notes' || h === 'comment'),
  };
}

// 'YYYY-MM-DD HH:mm:ss' (what xlsxAdapter emits for a datetime cell, also
// accepts a 'T' separator) -> the same string, or null. A date with no time
// is kept at midnight rather than dropped. Deliberately string-based: a
// meter's timestamp has no zone, and round-tripping through Date would shift
// the day whenever the server's zone differs from the user's.
function parseMeasuredAt(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/.exec(String(value ?? '').trim());
  if (!match) return null;
  return `${match[1]} ${match[2] || '00:00'}:${match[3] || '00'}`;
}

function toMgDl(value, unit) {
  const numeric = parseNumeric(value);
  if (numeric === null || numeric <= 0) return null;
  const isMmol = /mmol/i.test(String(unit || ''));
  return Math.round((isMmol ? numeric * MMOL_TO_MGDL : numeric) * 10) / 10;
}

// Meters label the meal context in their own words ("Before Meal", "Pre-meal",
// "No Meal Info"...). Stored as one of a fixed set so the card can group and
// compare on it; "No Meal Info" (the meter's "not set") is stored as null.
function normalizeMealContext(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(no meal info|none|n\/a|-+|unknown|not set)$/i.test(text)) return null;
  const key = text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (/fasting/.test(key)) return 'Fasting';
  if (/(before|pre) ?(meal|breakfast|lunch|dinner)|premeal/.test(key)) return 'Before Meal';
  if (/(after|post) ?(meal|breakfast|lunch|dinner)|postmeal|postprandial/.test(key)) return 'After Meal';
  if (/bed ?time|before sleep|night/.test(key)) return 'Bedtime';
  if (/random|general/.test(key)) return 'Random';
  return text;
}

function cellText(row, index) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

async function importGlucoseTable(userId, rows, columns, reportId = null) {
  const { dateIndex, glucoseIndex, unitIndex, mealIndex, sourceIndex, feelingIndex = -1, hematocritIndex = -1, noteIndex = -1 } = columns;
  let imported = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const measuredAt = parseMeasuredAt(row[dateIndex]);
    const value = toMgDl(row[glucoseIndex], unitIndex >= 0 ? row[unitIndex] : 'mg/dL');
    if (!measuredAt || value === null) continue;

    const meal = normalizeMealContext(mealIndex >= 0 ? row[mealIndex] : '');
    const source = cellText(row, sourceIndex);
    const feeling = cellText(row, feelingIndex);
    const note = cellText(row, noteIndex);
    const hematocrit = hematocritIndex >= 0 ? parseNumeric(row[hematocritIndex]) : null;

    // Re-uploading an overlapping export must never double-count a reading.
    const result = await pool.query(
      `INSERT INTO glucose_readings
         (user_id, report_id, measured_at, value_mg_dl, meal_context, source, feeling, hematocrit, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, measured_at, value_mg_dl) DO UPDATE SET
         -- A re-upload fills in columns an earlier import didn't capture,
         -- without ever overwriting what is already stored.
         meal_context = COALESCE(glucose_readings.meal_context, EXCLUDED.meal_context),
         source = COALESCE(glucose_readings.source, EXCLUDED.source),
         feeling = COALESCE(glucose_readings.feeling, EXCLUDED.feeling),
         hematocrit = COALESCE(glucose_readings.hematocrit, EXCLUDED.hematocrit),
         note = COALESCE(glucose_readings.note, EXCLUDED.note)
       RETURNING (xmax = 0) AS inserted`,
      [userId, reportId, measuredAt, value, meal, source || null, feeling || null, hematocrit, note || null]
    );
    if (result.rows[0]?.inserted) imported += 1;
  }

  return imported;
}

// Scans every table an adapter produced, imports the glucometer-shaped ones
// and returns the rest for normal extraction plus how many readings were
// imported. `detected` counts recognised glucometer tables (even when every
// row was already imported) so the caller can tell "nothing left to extract"
// from "nothing was a glucometer export".
async function importGlucoseTablesFrom(tables, userId, reportId = null) {
  if (!Array.isArray(tables)) return { remainingTables: tables, importedReadings: 0, detectedTables: 0 };

  const remainingTables = [];
  let importedReadings = 0;
  let detectedTables = 0;

  for (const rows of tables) {
    const columns = detectGlucoseTable(rows);
    if (columns) {
      detectedTables += 1;
      importedReadings += await importGlucoseTable(userId, rows, columns, reportId);
    } else {
      remainingTables.push(rows);
    }
  }

  return { remainingTables, importedReadings, detectedTables };
}

module.exports = {
  detectGlucoseTable,
  importGlucoseTable,
  importGlucoseTablesFrom,
  normalizeMealContext,
  parseMeasuredAt,
  toMgDl,
};
