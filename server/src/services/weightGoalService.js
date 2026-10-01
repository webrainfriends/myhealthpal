const pool = require('../db/pool');
const { ServiceError } = require('../lib/serviceError');

function toGoal(row) {
  return {
    currentWeightKg: row?.current_weight_kg != null ? Number(row.current_weight_kg) : null,
    targetWeightKg: row?.target_weight_kg != null ? Number(row.target_weight_kg) : null,
    targetDate: row?.target_date ? new Date(row.target_date).toISOString().slice(0, 10) : null,
  };
}

function isValidWeight(value) {
  return value === null || value === undefined || (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 500);
}

// Shared by /api/weight-goal and the MCP connector.
async function getWeightGoal(userId) {
  const { rows } = await pool.query('SELECT * FROM user_weight_goals WHERE user_id = $1', [userId]);
  return toGoal(rows[0]);
}

async function setWeightGoal(userId, body = {}) {
  if (!isValidWeight(body.currentWeightKg) || !isValidWeight(body.targetWeightKg)) {
    throw new ServiceError(400, 'Weights must be a positive number of kilograms.');
  }
  if (body.targetDate && Number.isNaN(new Date(body.targetDate).getTime())) {
    throw new ServiceError(400, 'targetDate is not a valid date.');
  }
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
  return toGoal(rows[0]);
}

module.exports = { getWeightGoal, setWeightGoal };
