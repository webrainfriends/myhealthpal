const pool = require('../db/pool');
const { ServiceError } = require('../lib/serviceError');

// Insight lifecycle actions shared by /api/insights/* and the MCP connector.
async function dismissInsight(userId, insightId) {
  const { rows } = await pool.query(
    `UPDATE insights SET lifecycle_state = 'dismissed', updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [insightId, userId]
  );
  if (rows.length === 0) throw new ServiceError(404, 'Insight not found');
  return rows[0];
}

async function setInsightFeedback(userId, insightId, feedback) {
  if (!['useful', 'not_useful'].includes(feedback)) {
    throw new ServiceError(400, 'feedback must be "useful" or "not_useful".');
  }
  const { rows } = await pool.query(
    `UPDATE insights SET user_feedback = $3, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [insightId, userId, feedback]
  );
  if (rows.length === 0) throw new ServiceError(404, 'Insight not found');
  return rows[0];
}

module.exports = { dismissInsight, setInsightFeedback };
