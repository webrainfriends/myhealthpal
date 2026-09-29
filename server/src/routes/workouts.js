const express = require('express');
const svc = require('../services/workoutService');
const video = require('../services/workoutVideoService');
const { videoUpload } = require('../middleware/upload');
const { requireConsent } = require('../security/consentService');

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

// ---- Retained workout video (issue #135 Phase 3) ---------------------------

router.get('/:id/video', wrap((req) => video.getStatus(req.user.id, req.params.id)));

// Multipart upload straight into the encrypted vault. Storing a recording
// needs the same consent as storing any other health file.
router.post(
  '/:id/video/upload',
  async (req, res, next) => {
    try {
      await requireConsent(req.user.id, 'medical_record_storage');
      next();
    } catch (err) {
      next(err);
    }
  },
  videoUpload.single('video'),
  async (req, res, next) => {
    try {
      if (req.fileValidationError) return res.status(400).json({ error: req.fileValidationError });
      res.status(201).json(await video.upload(req.user.id, req.params.id, req.file));
    } catch (err) {
      if (err instanceof svc.WorkoutError) return res.status(err.status).json({ error: err.message });
      return next(err);
    }
  }
);
router.post('/:id/video/complete', wrap((req) => video.completeUpload(req.user.id, req.params.id, { sha256: req.body?.sha256, md5: req.body?.md5 })));
router.post('/:id/video/local-deleted', wrap((req) => video.markLocalDeleted(req.user.id, req.params.id)));
router.post('/:id/video/url', wrap((req) => video.mintPlaybackUrl(req.user.id, req.params.id)));
router.delete('/:id/video', wrap((req) => video.hardDelete(req.user.id, req.params.id)));
router.get('/:id/pose-segments', wrap((req) => video.getPoseSegment(req.user.id, req.params.id)));
router.post('/:id/pose-segments', wrap((req) => video.savePoseSegment(req.user.id, req.params.id, req.body)));

// Multer's size-limit error -> a clear 413 instead of a generic 500.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The recording is too large to save.' });
  return next(err);
});

module.exports = router;
