const express = require('express');
const { getUserUsageSummary } = require('../services/aiUsageService');

const router = express.Router();

const ALLOWED_DAYS = [7, 30, 90, 365];

// The signed-in user's own AI token usage (Settings > AI usage) - totals
// for the chosen window, all-time, this sign-in session, and breakdowns by
// feature, day, and recent session. Always scoped to req.user; there is no
// way to ask for another user's usage here.
router.get('/', async (req, res, next) => {
  try {
    const requested = Number.parseInt(req.query.days, 10);
    const days = ALLOWED_DAYS.includes(requested) ? requested : 30;
    const summary = await getUserUsageSummary(req.user.id, { days, currentSessionId: req.sessionId || null });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
