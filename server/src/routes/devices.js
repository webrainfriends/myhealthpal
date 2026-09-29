const express = require('express');
const deviceService = require('../services/deviceService');

const router = express.Router();

function currentUserId(req) {
  return req.user.id;
}

// Paired Bluetooth/health-store devices (Accu-Chek Guide, Omron blood
// pressure monitors, Mi Scale 2, Apple Health, Health Connect) and the
// vital readings synced from them. All BLE scanning/pairing/GATT decoding
// happens on-device in the mobile app (see mobile/src/ble) - this router
// only ever receives already-decoded readings to store, never raw
// Bluetooth traffic.

router.get('/', async (req, res, next) => {
  try {
    const devices = await deviceService.listPairedDevices(currentUserId(req));
    res.json({ devices });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const device = await deviceService.pairDevice(currentUserId(req), req.body || {});
    res.status(201).json({ device });
  } catch (err) {
    next(err);
  }
});

router.patch('/:deviceId', async (req, res, next) => {
  try {
    const device = await deviceService.renameDevice(currentUserId(req), req.params.deviceId, req.body?.name);
    res.json({ device });
  } catch (err) {
    next(err);
  }
});

router.delete('/:deviceId', async (req, res, next) => {
  try {
    await deviceService.unpairDevice(currentUserId(req), req.params.deviceId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Body: { readings: [{ measuredAt, ...type-specific fields, rawPayload? }] }
// - the mobile BLE layer decodes GATT characteristics into this shape
// before ever calling here (see mobile/src/ble/parsers.js).
router.post('/:deviceId/readings', async (req, res, next) => {
  try {
    const result = await deviceService.recordReadings(currentUserId(req), req.params.deviceId, req.body?.readings);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/vitals/summary', async (req, res, next) => {
  try {
    const summary = await deviceService.getVitalsSummary(currentUserId(req));
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get('/vitals/history', async (req, res, next) => {
  try {
    const readings = await deviceService.getVitalsHistory(currentUserId(req), req.query.type, req.query.days);
    res.json({ readings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
