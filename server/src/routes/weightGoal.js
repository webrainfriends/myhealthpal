const express = require('express');
const { getWeightGoal, setWeightGoal } = require('../services/weightGoalService');
const { ServiceError } = require('../lib/serviceError');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await getWeightGoal(currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    res.json(await setWeightGoal(currentUserId(req), req.body));
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
