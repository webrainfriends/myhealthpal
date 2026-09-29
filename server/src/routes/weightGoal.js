const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

function toGoal(row) {
  return {
    currentWeightKg: row?.current_weight_kg != null ? Number(row.current_weight_kg) : null,
    targetWeightKg: row?.target_weight_kg != null ? Number(row.target_weight_kg) : null,
    targetDate: row?.target_date ? new Date(row.target_date).toISOString().slice(0, 10) : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM user_weight_goals WHERE user_id = $1', [currentUserId(req)]);
    res.json(toGoal(rows[0]));
  } catch (err) {
    next(err);
  }
});

function isValidWeight(value) {
  return value === null || value === undefined || (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 500);
}

router.put('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!isValidWeight(body.currentWeightKg) || !isValidWeight(body.targetWeightKg)) {
      return res.status(400).json({ error: 'Weights must be a positive number of kilograms.' });
    }
    if (body.targetDate && Number.isNaN(new Date(body.targetDate).getTime())) {
      return res.status(400).json({ error: 'targetDate is not a valid date.' });
    }

    const userId = currentUserId(req);
    const { rows } = await pool.query(
      `INSERT INTO user_weight_goals (user_id, current_weight_kg, target_weight_kg, target_date, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         current_weight_kg = EXCLUDED.current_weight_kg,
         target_weight_kg = EXCLUDED.target_weight_kg,
         target_date = EXCLUDED.target_date,
         updated_at = now()
       RETURNING *`,
      [userId, body.currentWeightKg ?? null, body.targetWeightKg ?? null, body.targetDate || null]
    );
    res.json(toGoal(rows[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
