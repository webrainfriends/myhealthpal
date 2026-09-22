const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

// Fixed, app-wide daily goals (steps/exercise/stand), mirroring Apple
// Health's three-ring defaults - not yet per-user customizable. Deliberately
// separate from the Health Parameter Registry's reference_ranges table
// (reference_ranges scores a lab result against a clinical range; a daily
// activity goal is a personal target, not a clinical threshold).
const GOALS = { steps: 10000, exerciseMinutes: 30, standHours: 12 };

function ringPercent(value, goal) {
  if (value === null || value === undefined || !goal) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

// pg returns a DATE column as a JS Date; a synthesized "no log for this day"
// placeholder (see /summary below) passes the date through as a plain
// "YYYY-MM-DD" string instead - normalize both to the same string shape so
// every entry in a response is uniform.
function normalizeDate(logDate) {
  if (!logDate) return null;
  return typeof logDate === 'string' ? logDate : logDate.toISOString().slice(0, 10);
}

function toSummary(row) {
  const steps = row?.steps ?? null;
  const exerciseMinutes = row?.exercise_minutes ?? null;
  const standHours = row?.stand_hours ?? null;
  const caloriesBurned = row?.calories_burned ?? null;
  const distanceMeters = row?.distance_meters !== null && row?.distance_meters !== undefined
    ? Number(row.distance_meters)
    : null;
  return {
    date: normalizeDate(row?.log_date),
    steps,
    exerciseMinutes,
    standHours,
    caloriesBurned,
    distanceMeters,
    rings: {
      steps: ringPercent(steps, GOALS.steps),
      exerciseMinutes: ringPercent(exerciseMinutes, GOALS.exerciseMinutes),
      standHours: ringPercent(standHours, GOALS.standHours),
    },
  };
}

// A rings/legend display is only useful once it has a real day behind it -
// a manual same-day logger has one, but a wearable export (see
// activityImportService.js) is a historical dump that rarely includes
// "today" (the export was generated some time before upload), so a strict
// "today" would show an empty ring for every one of those uploads even
// though real recent data exists just one or two days back.
function hasLoggedActivity(entry) {
  return Boolean(entry) && (entry.steps !== null || entry.exerciseMinutes !== null || entry.standHours !== null);
}

// Today's log (for the rings) plus a recent-day history (for a bar graph) -
// one call covers both, since the dashboard's compact card and the full
// Activity screen both need "today" and the full screen also wants history.
router.get('/summary', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 14, 1), 90);

    const { rows } = await pool.query(
      `SELECT log_date, steps, exercise_minutes, stand_hours, calories_burned, distance_meters
       FROM activity_logs
       WHERE user_id = $1 AND log_date >= CURRENT_DATE - ($2::int - 1)
       ORDER BY log_date ASC`,
      [userId, days]
    );

    const byDate = new Map(rows.map((row) => [row.log_date.toISOString().slice(0, 10), row]));
    const todayKey = new Date().toISOString().slice(0, 10);
    const todaySummary = toSummary(byDate.get(todayKey) || null);

    // Always return one entry per day in the window, even with no log, so
    // the client can draw a fixed-width bar graph without gap-filling itself.
    const history = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      history.push(toSummary(byDate.get(key) || { log_date: key }));
    }

    // The rings' actual "current" day: today's own log when there is one,
    // else the most recent day in the fetched window that has anything
    // logged at all - never a blank ring just because the window's newest
    // data lags behind the calendar. isCurrentToday tells the client
    // whether to label it "Today" or with its real date.
    const mostRecentLogged = [...history].reverse().find(hasLoggedActivity) || null;
    const current = hasLoggedActivity(todaySummary) ? todaySummary : mostRecentLogged || todaySummary;

    res.json({
      goals: GOALS,
      today: todaySummary,
      current,
      isCurrentToday: current.date === todayKey,
      history,
    });
  } catch (err) {
    next(err);
  }
});

// Upserts a single day's log. Partial: an omitted field leaves whatever is
// already stored for that day untouched (so logging steps at noon doesn't
// wipe out an exercise-minutes entry from the morning).
router.post('/', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const logDate = req.body.log_date || new Date().toISOString().slice(0, 10);

    for (const field of ['steps', 'exercise_minutes', 'stand_hours']) {
      const value = req.body[field];
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
        return res.status(400).json({ error: `${field} must be a non-negative number` });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO activity_logs (user_id, log_date, steps, exercise_minutes, stand_hours)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, log_date) DO UPDATE SET
         steps = COALESCE(EXCLUDED.steps, activity_logs.steps),
         exercise_minutes = COALESCE(EXCLUDED.exercise_minutes, activity_logs.exercise_minutes),
         stand_hours = COALESCE(EXCLUDED.stand_hours, activity_logs.stand_hours),
         updated_at = now()
       RETURNING log_date, steps, exercise_minutes, stand_hours, calories_burned, distance_meters`,
      [
        userId,
        logDate,
        req.body.steps ?? null,
        req.body.exercise_minutes ?? null,
        req.body.stand_hours ?? null,
      ]
    );

    res.json({ goals: GOALS, log: toSummary(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
