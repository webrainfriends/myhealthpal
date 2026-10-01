const express = require('express');
const { getGlucoseSummary } = require('../services/glucoseService');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await getGlucoseSummary(currentUserId(req), req.query.days));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
