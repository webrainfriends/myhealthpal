const express = require('express');
const pool = require('../db/pool');
const config = require('../config');

const router = express.Router();

function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT hp.* FROM user_pinned_parameters pinned
       JOIN health_parameters hp ON hp.id = pinned.health_parameter_id
       WHERE pinned.user_id = $1
       ORDER BY hp.display_name ASC`,
      [currentUserId(req)]
    );
    res.json({ pinned: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.body.health_parameter_id) {
      return res.status(400).json({ error: 'health_parameter_id is required.' });
    }
    await pool.query(
      `INSERT INTO user_pinned_parameters (user_id, health_parameter_id) VALUES ($1, $2)
       ON CONFLICT (user_id, health_parameter_id) DO NOTHING`,
      [currentUserId(req), req.body.health_parameter_id]
    );
    res.status(201).json({ status: 'pinned' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:parameterId', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM user_pinned_parameters WHERE user_id = $1 AND health_parameter_id = $2', [
      currentUserId(req),
      req.params.parameterId,
    ]);
    res.json({ status: 'unpinned' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
