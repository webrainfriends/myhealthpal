const pool = require('../db/pool');
const { NUTRIENT_FIELDS } = require('../extraction/providers/nutrientFields');

// Read side of the diet log, shared by /api/diet/* and the MCP connector.

// `query` mirrors the route's query string: { unconfirmed: 'true' } for the
// review queue, else { date } or { from, to }; default is today (UTC).
async function listEntries(userId, query = {}) {
  if (query.unconfirmed === 'true') {
    const { rows } = await pool.query(
      `SELECT * FROM food_entries WHERE user_id = $1 AND is_confirmed = false ORDER BY consumed_at DESC`,
      [userId]
    );
    return rows;
  }

  let from;
  let to;
  if (query.date) {
    from = `${query.date}T00:00:00.000Z`;
    to = `${query.date}T23:59:59.999Z`;
  } else if (query.from || query.to) {
    from = query.from ? `${query.from}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
    to = query.to ? `${query.to}T23:59:59.999Z` : new Date().toISOString();
  } else {
    const today = new Date().toISOString().slice(0, 10);
    from = `${today}T00:00:00.000Z`;
    to = `${today}T23:59:59.999Z`;
  }

  const { rows } = await pool.query(
    `SELECT * FROM food_entries WHERE user_id = $1 AND consumed_at BETWEEN $2 AND $3
     ORDER BY consumed_at ASC`,
    [userId, from, to]
  );
  return rows;
}

async function getSummary(userId, daysParam) {
  const days = Math.min(Math.max(Number.parseInt(daysParam, 10) || 7, 1), 90);

  const { rows } = await pool.query(
    `SELECT id, name, meal_type, ${NUTRIENT_FIELDS.join(', ')}, consumed_at, is_confirmed, needs_quantity, needs_review
     FROM food_entries
     WHERE user_id = $1 AND consumed_at >= CURRENT_DATE - ($2::int - 1) AND is_confirmed = true
     ORDER BY consumed_at ASC`,
    [userId, days]
  );

  function emptyDay(key) {
    const day = { date: key, meals: { breakfast: [], lunch: [], snack: [], dinner: [], supper: [] } };
    for (const field of NUTRIENT_FIELDS) day[field] = 0;
    return day;
  }

  const byDay = new Map();
  for (const row of rows) {
    const key = new Date(row.consumed_at).toISOString().slice(0, 10);
    const day = byDay.get(key) || emptyDay(key);
    for (const field of NUTRIENT_FIELDS) day[field] += Number(row[field]) || 0;
    day.meals[row.meal_type].push({ id: row.id, name: row.name, calories: row.calories });
    byDay.set(key, day);
  }

  const history = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    history.push(byDay.get(key) || emptyDay(key));
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const today = byDay.get(todayKey) || history[history.length - 1];

  const pendingReview = await pool.query(
    `SELECT count(*)::int AS count FROM food_entries WHERE user_id = $1 AND is_confirmed = false`,
    [userId]
  );

  return { today, history, pendingReviewCount: pendingReview.rows[0].count };
}

module.exports = { listEntries, getSummary };
