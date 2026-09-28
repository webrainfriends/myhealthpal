const express = require('express');
const healthProfileService = require('../services/healthProfileService');

const router = express.Router();

// req.user is set by requireAuth from a verified session token, and is
// whichever profile is currently active (the account itself, or a family
// member it's switched to via X-Profile-Id) - same as weightGoal.js, so a
// caregiver records a managed profile's own weight/height/allergies, never
// their own by mistake.
function currentUserId(req) {
  return req.user.id;
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await healthProfileService.getProfile(currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

router.post('/weight', async (req, res, next) => {
  try {
    res.status(201).json(await healthProfileService.addWeightEntry(currentUserId(req), req.body.weightKg));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/height', async (req, res, next) => {
  try {
    res.status(201).json(await healthProfileService.addHeightEntry(currentUserId(req), req.body.heightCm));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/allergies', async (req, res, next) => {
  try {
    res.status(201).json(await healthProfileService.addAllergy(currentUserId(req), req.body.allergen));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.delete('/allergies/:id', async (req, res, next) => {
  try {
    res.json(await healthProfileService.removeAllergy(currentUserId(req), req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
