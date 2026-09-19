const express = require('express');
const pool = require('../db/pool');
const config = require('../config');

const router = express.Router();

function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
}

router.get('/', async (req, res, next) => {
  try {
    const state = req.query.state || 'active';
    const { rows } = await pool.query(
      `SELECT i.*, hp.display_name AS parameter_display_name, hp.category AS parameter_category
       FROM insights i
       LEFT JOIN health_parameters hp ON hp.id = i.health_parameter_id
       WHERE i.user_id = $1 AND ($2 = 'all' OR i.lifecycle_state = $2)
       ORDER BY i.generated_at DESC
       LIMIT 50`,
      [currentUserId(req), state]
    );
    res.json({ insights: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE insights SET lifecycle_state = 'dismissed', updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, currentUserId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Insight not found' });
    res.json({ insight: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/feedback', async (req, res, next) => {
  try {
    if (!['useful', 'not_useful'].includes(req.body.feedback)) {
      return res.status(400).json({ error: 'feedback must be "useful" or "not_useful".' });
    }
    const { rows } = await pool.query(
      `UPDATE insights SET user_feedback = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, currentUserId(req), req.body.feedback]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Insight not found' });
    res.json({ insight: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
