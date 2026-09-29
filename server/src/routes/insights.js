const express = require('express');
const pool = require('../db/pool');
const { referenceSourceFor } = require('../medications/citationSources');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/', async (req, res, next) => {
  try {
    const state = req.query.state || 'active';
    const { rows } = await pool.query(
      `SELECT i.*, hp.display_name AS parameter_display_name, hp.category AS parameter_category,
              rr.citation AS reference_citation, rr.source AS reference_source, rr.source_url AS reference_source_url
       FROM insights i
       LEFT JOIN health_parameters hp ON hp.id = i.health_parameter_id
       LEFT JOIN LATERAL (
         SELECT citation, source, source_url FROM reference_ranges
         WHERE health_parameter_id = i.health_parameter_id AND condition_label = 'general'
         LIMIT 1
       ) rr ON true
       WHERE i.user_id = $1 AND ($2 = 'all' OR i.lifecycle_state = $2)
       ORDER BY i.generated_at DESC
       LIMIT 50`,
      [currentUserId(req), state]
    );
    // Only ever a real, government/WHO-backed link a user can click to read
    // more about the standard behind this parameter - never fabricated, and
    // simply omitted when this insight's parameter has no reference range on
    // file (see citationSources.js).
    const insights = rows.map((row) => {
      const { reference_citation, reference_source, reference_source_url, ...insight } = row;
      const citation = reference_source
        ? { text: reference_citation, ...referenceSourceFor(reference_source, reference_source_url) }
        : null;
      return { ...insight, citation };
    });
    res.json({ insights });
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
