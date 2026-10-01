const express = require('express');
const pool = require('../db/pool');
const { GOALS, normalizeDate, loadWorkoutTotals, toSummary, getActivitySummary } = require('../services/activitySummaryService');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await getActivitySummary(currentUserId(req), req.query.days));
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

    const dayKey = normalizeDate(rows[0].log_date);
    const workoutsByDate = await loadWorkoutTotals(userId, 90);
    res.json({ goals: GOALS, log: toSummary(rows[0], workoutsByDate.get(dayKey)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Exposed for activity.test.js only - the app still mounts this module
// directly as Express middleware (module.exports is still the router
// itself), this just also hangs normalizeDate off it so its behavior
// against the pg driver's actual DATE type-parser setting can be tested
// without duplicating that logic in the test file.
module.exports.normalizeDate = normalizeDate;
