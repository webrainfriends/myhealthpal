const express = require('express');
const waterService = require('../water/waterService');
const waterTargetService = require('../water/waterTargetService');

const router = express.Router();

function currentUserId(req) {
  return req.user.id;
}

function parseLoggedAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Today's (or a given date's) entries + running total, the current
// min/ideal/max target, and - only for today, since alerting on a past
// day's total isn't actionable - a deterministic under/over alert.
router.get('/summary', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const date = req.query.date || todayKey();

    const [{ entries, totalMl }, target] = await Promise.all([
      waterService.getDaySummary(userId, date),
      waterTargetService.getOrGenerateWaterTarget(userId),
    ]);

    const alert = date === todayKey() ? waterTargetService.evaluateIntake(totalMl, target) : null;

    res.json({
      date,
      entries,
      totalMl,
      target,
      alert,
      remindersEnabled: req.accountUser.water_reminders_enabled,
    });
  } catch (err) {
    next(err);
  }
});

// Daily totals for the last N days plus the current target - the data behind
// the Diet stats "Water intake" chart and its stats tiles.
router.get('/history', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const [history, target] = await Promise.all([
      waterService.getHistory(userId, req.query.days),
      waterTargetService.getOrGenerateWaterTarget(userId),
    ]);
    res.json({ days: history, target });
  } catch (err) {
    next(err);
  }
});

router.post('/entries', async (req, res, next) => {
  try {
    const body = req.body || {};
    const entry = await waterService.logWaterEntry(currentUserId(req), {
      amountMl: body.amount_ml,
      loggedAt: parseLoggedAt(body.logged_at),
    });
    res.status(201).json({ entry });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/entries/:id', async (req, res, next) => {
  try {
    const deleted = await waterService.deleteWaterEntry(currentUserId(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Water entry not found.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/target', async (req, res, next) => {
  try {
    const target = await waterTargetService.getOrGenerateWaterTarget(currentUserId(req));
    res.json({ target });
  } catch (err) {
    next(err);
  }
});

router.post('/target/refresh', async (req, res, next) => {
  try {
    const target = await waterTargetService.generateWaterTarget(currentUserId(req));
    res.json({ target });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
