const pool = require('../db/pool');
const { ServiceError } = require('../lib/serviceError');

// Fixed, app-wide daily goals (steps/exercise/stand), mirroring Apple
// Health's three-ring defaults - not yet per-user customizable. Deliberately
// separate from the Health Parameter Registry's reference_ranges table
// (reference_ranges scores a lab result against a clinical range; a daily
// activity goal is a personal target, not a clinical threshold).
// caloriesBurned is the active-energy ("Move") goal in kcal.
const GOALS = { steps: 10000, exerciseMinutes: 30, standHours: 12, caloriesBurned: 400 };

function ringPercent(value, goal) {
  if (value === null || value === undefined || !goal) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

// db/pool.js's DATE type parser returns activity_logs.log_date as a plain
// 'YYYY-MM-DD' string, not a JS Date (see its comment for why) - but a
// synthesized "no log for this day" placeholder (see /summary below) also
// passes a plain string, and either shape could change again later, so this
// stays defensive rather than assuming today's shape everywhere it's used.
function normalizeDate(logDate) {
  if (!logDate) return null;
  return typeof logDate === 'string' ? logDate : logDate.toISOString().slice(0, 10);
}

// Completed AI Workout Coach sessions, summed per UTC day (the same day
// convention this summary already uses). Read live rather than written into
// activity_logs: device syncs/imports overwrite that row, and computing at
// read time means deleting a workout removes its share immediately.
async function loadWorkoutTotals(userId, days) {
  const { rows } = await pool.query(
    `SELECT (completed_at AT TIME ZONE 'UTC')::date AS day,
            COUNT(*)::int AS count,
            ROUND(COALESCE(SUM(active_seconds), 0) / 60.0)::int AS minutes,
            ROUND(COALESCE(SUM((estimated_calories_low + estimated_calories_high) / 2.0), 0))::int AS calories
     FROM workout_session
     WHERE user_id = $1 AND status = 'completed'
       AND (completed_at AT TIME ZONE 'UTC')::date >= CURRENT_DATE - ($2::int - 1)
     GROUP BY 1`,
    [userId, days]
  );
  return new Map(rows.map((r) => [normalizeDate(r.day), { count: r.count, minutes: r.minutes, calories: r.calories }]));
}

function toSummary(row, workouts) {
  const w = workouts && workouts.count > 0 ? workouts : { count: 0, minutes: 0, calories: 0 };
  const steps = row?.steps ?? null;
  // A day with only workouts still has exercise minutes / calories; a day
  // with neither stays null (nothing logged).
  const exerciseMinutes = row?.exercise_minutes != null || w.count > 0 ? (row?.exercise_minutes ?? 0) + w.minutes : null;
  const standHours = row?.stand_hours ?? null;
  const caloriesBurned = row?.calories_burned != null || w.count > 0 ? (row?.calories_burned ?? 0) + w.calories : null;
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
    workouts: w,
    rings: {
      caloriesBurned: ringPercent(caloriesBurned, GOALS.caloriesBurned),
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
  return Boolean(entry) && (entry.steps !== null || entry.exerciseMinutes !== null || entry.standHours !== null || entry.caloriesBurned !== null);
}

// Today's log (for the rings) plus a recent-day history (for a bar graph) -
// one call covers both, since the dashboard's compact card and the full
// Activity screen both need "today" and the full screen also wants history.
// Shared by GET /api/activity/summary and the MCP connector.
async function getActivitySummary(userId, daysParam) {
  const days = Math.min(Math.max(Number.parseInt(daysParam, 10) || 14, 1), 90);

  const { rows } = await pool.query(
    `SELECT log_date, steps, exercise_minutes, stand_hours, calories_burned, distance_meters
     FROM activity_logs
     WHERE user_id = $1 AND log_date >= CURRENT_DATE - ($2::int - 1)
     ORDER BY log_date ASC`,
    [userId, days]
  );

  const byDate = new Map(rows.map((row) => [normalizeDate(row.log_date), row]));
  const workoutsByDate = await loadWorkoutTotals(userId, days);
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySummary = toSummary(byDate.get(todayKey) || null, workoutsByDate.get(todayKey));

  // Always return one entry per day in the window, even with no log, so
  // the client can draw a fixed-width bar graph without gap-filling itself.
  const history = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    history.push(toSummary(byDate.get(key) || { log_date: key }, workoutsByDate.get(key)));
  }

  // The rings' actual "current" day: today's own log when there is one,
  // else the most recent day in the fetched window that has anything
  // logged at all - never a blank ring just because the window's newest
  // data lags behind the calendar. isCurrentToday tells the client
  // whether to label it "Today" or with its real date.
  const mostRecentLogged = [...history].reverse().find(hasLoggedActivity) || null;
  const current = hasLoggedActivity(todaySummary) ? todaySummary : mostRecentLogged || todaySummary;

  return {
    goals: GOALS,
    today: todaySummary,
    current,
    isCurrentToday: current.date === todayKey,
    history,
  };
}

// Upserts a single day's log. Partial: an omitted field leaves whatever is
// already stored for that day untouched (so logging steps at noon doesn't
// wipe out an exercise-minutes entry from the morning). Shared by
// POST /api/activity and the MCP connector.
async function logActivity(userId, body = {}) {
  const logDate = body.log_date || new Date().toISOString().slice(0, 10);

  for (const field of ['steps', 'exercise_minutes', 'stand_hours']) {
    const value = body[field];
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new ServiceError(400, `${field} must be a non-negative number`);
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
    [userId, logDate, body.steps ?? null, body.exercise_minutes ?? null, body.stand_hours ?? null]
  );

  const dayKey = normalizeDate(rows[0].log_date);
  const workoutsByDate = await loadWorkoutTotals(userId, 90);
  return { goals: GOALS, log: toSummary(rows[0], workoutsByDate.get(dayKey)) };
}

module.exports = { GOALS, normalizeDate, loadWorkoutTotals, toSummary, getActivitySummary, logActivity };
