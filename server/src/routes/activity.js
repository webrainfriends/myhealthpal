const express = require('express');
const { normalizeDate, getActivitySummary, logActivity } = require('../services/activitySummaryService');
const { ServiceError } = require('../lib/serviceError');

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

router.post('/', async (req, res, next) => {
  try {
    res.json(await logActivity(currentUserId(req), req.body));
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
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
