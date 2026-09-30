const pool = require('../db/pool');

// Plain per-entry water log (028_water_intake.sql) - the same "just a log
// table" shape food_entries uses, minus everything diet-specific. Quick-add
// buttons on the client send 250/500/1000/2000ml, but any positive amount
// up to the table's 5000ml single-entry cap is accepted (e.g. a custom
// amount), matching the CHECK constraint.

const MAX_SINGLE_ENTRY_ML = 5000;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function dayWindow(dateStr) {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  return { from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z`, date };
}

function validateAmountMl(amountMl) {
  const amount = Number(amountMl);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_SINGLE_ENTRY_ML) {
    throw httpError(`amount_ml must be a number between 1 and ${MAX_SINGLE_ENTRY_ML}.`, 400);
  }
  return Math.round(amount);
}

async function logWaterEntry(userId, { amountMl, loggedAt } = {}) {
  const amount = validateAmountMl(amountMl);
  const when = loggedAt instanceof Date && !Number.isNaN(loggedAt.getTime()) ? loggedAt : new Date();

  const { rows } = await pool.query(
    `INSERT INTO water_entries (user_id, amount_ml, logged_at) VALUES ($1, $2, $3) RETURNING *`,
    [userId, amount, when]
  );
  return rows[0];
}

// Entries for one calendar day (device-local "today" by default) plus the
// running total - one query the route/target-alert logic both need, so
// callers don't have to fetch entries and separately re-sum them.
async function getDaySummary(userId, dateStr) {
  const { from, to, date } = dayWindow(dateStr);
  const { rows } = await pool.query(
    `SELECT * FROM water_entries WHERE user_id = $1 AND logged_at BETWEEN $2 AND $3 ORDER BY logged_at ASC`,
    [userId, from, to]
  );
  const totalMl = rows.reduce((sum, row) => sum + row.amount_ml, 0);
  return { date, entries: rows, totalMl };
}

// One row per calendar day (UTC, the same day boundary getDaySummary uses) for
// the last `days` days ending today - including days with nothing logged, so
// the client can draw a fixed-width chart and count "goal days" without
// gap-filling itself.
async function getHistory(userId, days = 14) {
  const span = Math.min(Math.max(Number.parseInt(days, 10) || 14, 1), 90);
  const { rows } = await pool.query(
    `SELECT to_char((logged_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
            SUM(amount_ml)::int AS total_ml, COUNT(*)::int AS entries
     FROM water_entries
     WHERE user_id = $1 AND logged_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - ($2::int - 1) * interval '1 day') AT TIME ZONE 'UTC'
     GROUP BY 1`,
    [userId, span]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const result = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    result.push({ date: key, totalMl: row ? row.total_ml : 0, entries: row ? row.entries : 0 });
  }
  return result;
}

async function deleteWaterEntry(userId, entryId) {
  const { rows } = await pool.query('DELETE FROM water_entries WHERE id = $1 AND user_id = $2 RETURNING id', [
    entryId,
    userId,
  ]);
  return rows.length > 0;
}

module.exports = { MAX_SINGLE_ENTRY_ML, logWaterEntry, getDaySummary, getHistory, deleteWaterEntry };
