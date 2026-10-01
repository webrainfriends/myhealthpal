const express = require('express');
const { listTimeline } = require('../services/timelineService');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

// Query logic lives in services/timelineService.js (shared with the MCP connector).
router.get('/', async (req, res, next) => {
  try {
    const { dateFrom = null, dateTo = null, reportType = null, source = null, category = null, search = null } = req.query;
    res.json({ timeline: await listTimeline(currentUserId(req), { dateFrom, dateTo, reportType, source, category, search }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
