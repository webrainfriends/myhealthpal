const express = require('express');
const pool = require('../db/pool');
const { recomputeForUser, listVisiblePlans } = require('../retest/retestService');
const config = require('../config');
const { addDays, weekStart, bookingUrl } = require('../retest/retestRules');

function withBookingUrl(plan) {
  return { ...plan, bookingUrl: bookingUrl(config.labBookingUrlTemplate, plan.parameterDisplayName) };
}

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

const MAX_SNOOZE_DAYS = 60;

router.get('/', async (req, res, next) => {
  try {
    await recomputeForUser(currentUserId(req));
    const plans = (await listVisiblePlans(currentUserId(req))).map(withBookingUrl);
    // Reminders are the signed-in account's setting (it's their phone),
    // even while viewing a family member's plans.
    res.json({ plans, remindersEnabled: req.accountUser.retest_reminders_enabled });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/snooze', async (req, res, next) => {
  try {
    const days = Number(req.body.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > MAX_SNOOZE_DAYS) {
      return res.status(400).json({ error: `days must be a whole number from 1 to ${MAX_SNOOZE_DAYS}.` });
    }
    const snoozedUntil = addDays(new Date().toISOString().slice(0, 10), days);
    const { rows } = await pool.query(
      `UPDATE retest_plans SET status = 'snoozed', snoozed_until = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status IN ('active', 'snoozed') RETURNING id, status, snoozed_until`,
      [req.params.id, currentUserId(req), snoozedUntil]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dismiss', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE retest_plans SET status = 'dismissed', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status IN ('active', 'snoozed') RETURNING id, status`,
      [req.params.id, currentUserId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Toggles this week's micro-action check-in: { done: true | false }.
router.post('/:id/checkin', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id FROM retest_plans WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      currentUserId(req),
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const week = weekStart(new Date());
    if (req.body.done === false) {
      await pool.query('DELETE FROM retest_checkins WHERE plan_id = $1 AND week_start = $2', [req.params.id, week]);
    } else {
      await pool.query(
        'INSERT INTO retest_checkins (plan_id, week_start) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, week]
      );
    }
    const plans = await listVisiblePlans(currentUserId(req));
    const plan = plans.find((p) => p.id === req.params.id);
    res.json({ plan: plan ? withBookingUrl(plan) : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
