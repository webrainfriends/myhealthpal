const express = require('express');
const pool = require('../db/pool');
const { referenceSourceFor } = require('../medications/citationSources');

const { dismissInsight, setInsightFeedback } = require('../services/insightActionService');
const { ServiceError } = require('../lib/serviceError');

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

function handle(fn) {
  return async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

router.post('/:id/dismiss', handle(async (req) => ({ insight: await dismissInsight(currentUserId(req), req.params.id) })));

router.post('/:id/feedback', handle(async (req) => ({
  insight: await setInsightFeedback(currentUserId(req), req.params.id, req.body.feedback),
})));

module.exports = router;
