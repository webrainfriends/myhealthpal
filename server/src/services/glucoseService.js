const pool = require('../db/pool');
const { summarizeGlucose } = require('./glucoseSummaryService');

const LAB_CODES = ['glucose_fasting', 'glucose_post_prandial', 'hba1c', 'glucose_mean'];

// Latest lab-report value per diabetes code, scoped the same way the organ
// cards are (a report that finished extraction, duplicates excluded).
async function fetchLatestLabs(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (hp.code)
            hp.code, COALESCE(hm.normalized_value, hm.numeric_value) AS value,
            COALESCE(hm.sample_datetime::date, r.effective_date, r.created_at::date) AS date,
            r.id AS report_id
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE r.user_id = $1
       AND hp.code = ANY($2)
       AND COALESCE(hm.normalized_value, hm.numeric_value) IS NOT NULL
       AND r.ingestion_status IN ('Needs Review', 'Completed')
       AND hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')
     ORDER BY hp.code, COALESCE(hm.sample_datetime::date, r.effective_date, r.created_at::date) DESC`,
    [userId, LAB_CODES]
  );
  const labs = {};
  for (const row of rows) {
    const date = typeof row.date === 'string' ? row.date : row.date?.toISOString().slice(0, 10);
    labs[row.code] = { value: Number(row.value), date: date || null, reportId: row.report_id };
  }
  return labs;
}

// Shared by GET /api/glucose/summary and the MCP connector. summarizeGlucose
// (glucoseSummaryService.js) stays pure; this is its database side.
async function getGlucoseSummary(userId, daysParam) {
  // The window ends at the newest reading rather than today: an export is a
  // historical dump, and an older one should still show its own days.
  const days = Math.min(Math.max(Number.parseInt(daysParam, 10) || 30, 1), 365);
  const { rows } = await pool.query(
    `SELECT to_char(measured_at, 'YYYY-MM-DD') AS day, to_char(measured_at, 'HH24:MI') AS time,
            value_mg_dl, meal_context, feeling, hematocrit, note
     FROM glucose_readings
     WHERE user_id = $1
       AND measured_at >= (
         SELECT max(measured_at)::date FROM glucose_readings WHERE user_id = $1
       ) - ($2::int - 1)
     ORDER BY measured_at ASC`,
    [userId, days]
  );
  const readings = rows.map((row) => ({
    day: row.day,
    time: row.time,
    value: Number(row.value_mg_dl),
    mealContext: row.meal_context,
    feeling: row.feeling,
    hematocrit: row.hematocrit === null ? null : Number(row.hematocrit),
    note: row.note,
  }));

  return summarizeGlucose(readings, await fetchLatestLabs(userId));
}

module.exports = { getGlucoseSummary, fetchLatestLabs };
