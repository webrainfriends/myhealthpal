const express = require('express');
const watchService = require('../services/watchService');
const { requireAccountAuth } = require('../middleware/auth');

const router = express.Router();

// Pairing needs only a few requests per watch, so the limits are tight: the
// 6-digit code is guessable otherwise. Counted in memory per key (one process;
// good enough for a 5-minute window, and a restart only forgives, not breaks).
const attempts = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > max;
}

function sendError(res, next, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  return next(err);
}

// --- Watch side (no sign-in: the watch has no token yet) -------------------

router.post('/pair/start', async (req, res, next) => {
  try {
    if (limited(`start:${req.ip}`, 20, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many pairing attempts. Try again later.' });
    const { deviceName, platform } = req.body || {};
    res.status(201).json(await watchService.startPairing({ deviceName, platform }));
  } catch (err) {
    sendError(res, next, err);
  }
});

router.post('/pair/poll', async (req, res, next) => {
  try {
    const { pairingId, pollSecret } = req.body || {};
    res.json(await watchService.pollPairing({ pairingId, pollSecret }));
  } catch (err) {
    sendError(res, next, err);
  }
});

// --- Phone side (signed-in account; a watch token is refused here) ---------

router.post('/pair/confirm', requireAccountAuth, async (req, res, next) => {
  try {
    if (limited(`confirm:${req.accountUser.id}`, 8, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many wrong codes. Wait a few minutes and try again.' });
    }
    const device = await watchService.confirmPairing(req.accountUser.id, req.body?.code);
    res.json({ device });
  } catch (err) {
    sendError(res, next, err);
  }
});

router.get('/devices', requireAccountAuth, async (req, res, next) => {
  try {
    res.json({ devices: await watchService.listDevices(req.accountUser.id) });
  } catch (err) {
    next(err);
  }
});

router.delete('/devices/:id', requireAccountAuth, async (req, res, next) => {
  try {
    const ok = await watchService.revokeDevice(req.accountUser.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Watch not found.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
