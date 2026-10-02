const express = require('express');
const { recomputeForUser, listVisiblePlans, snoozePlan, dismissPlan, setCheckin } = require('../retest/retestService');
const { ServiceError } = require('../lib/serviceError');
const config = require('../config');
const { bookingFor } = require('../retest/retestRules');

function withBookingUrl(plan) {
  const booking = bookingFor(config.labBookingUrlTemplate, plan);
  return { ...plan, bookingUrl: booking.url, booking };
}

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

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

router.post('/:id/snooze', handle(async (req) => ({ plan: await snoozePlan(currentUserId(req), req.params.id, req.body.days ?? 7) })));

router.post('/:id/dismiss', handle(async (req) => ({ plan: await dismissPlan(currentUserId(req), req.params.id) })));

// Toggles this week's micro-action check-in: { done: true | false }.
router.post('/:id/checkin', handle(async (req) => {
  const plan = await setCheckin(currentUserId(req), req.params.id, req.body.done);
  return { plan: plan ? withBookingUrl(plan) : null };
}));

module.exports = router;
