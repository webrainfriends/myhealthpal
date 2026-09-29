const express = require('express');
const svc = require('../services/workoutService');

const router = express.Router();

// req.user comes from requireAuth (verified session token); ownership is
// always enforced by user id inside workoutService - never from the client.
const wrap = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof svc.WorkoutError) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

router.get('/exercises', wrap(() => svc.listExercises().then((exercises) => ({ exercises }))));
router.get('/history', wrap((req) => svc.history(req.user.id, req.query.limit).then((workouts) => ({ workouts }))));
router.get('/plans', wrap((req) => svc.listPlans(req.user.id).then((plans) => ({ plans }))));
router.post('/plans', wrap((req) => svc.createPlan(req.user.id, req.body)));
router.get('/plans/:id', wrap((req) => svc.getPlan(req.user.id, req.params.id)));
router.delete('/plans/:id', wrap((req) => svc.deletePlan(req.user.id, req.params.id)));
router.post('/plans/:id/run', wrap((req) => svc.runPlan(req.user.id, req.params.id)));
router.post('/', wrap((req) => svc.createSession(req.user.id, req.body)));
router.post('/:id/start', wrap((req) => svc.startSession(req.user.id, req.params.id)));
router.post('/:id/sets', wrap((req) => svc.recordSets(req.user.id, req.params.id, req.body)));
router.post('/:id/complete', wrap((req) => svc.completeSession(req.user.id, req.params.id, req.body)));
router.get('/:id/summary', wrap((req) => svc.getSummary(req.user.id, req.params.id)));

module.exports = router;
