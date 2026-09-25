const express = require('express');
const pool = require('../db/pool');

// Settings that belong to the signed-in account (its devices, its
// notification preferences), mounted with requireAccountAuth so they are
// never redirected to a family profile the client has selected.
const router = express.Router();

router.put('/retest-settings', async (req, res, next) => {
  try {
    if (typeof req.body.remindersEnabled !== 'boolean') {
      return res.status(400).json({ error: 'remindersEnabled must be true or false.' });
    }
    await pool.query('UPDATE users SET retest_reminders_enabled = $2 WHERE id = $1', [
      req.accountUser.id,
      req.body.remindersEnabled,
    ]);
    res.json({ remindersEnabled: req.body.remindersEnabled });
  } catch (err) {
    next(err);
  }
});

// Registers (or re-assigns) this device's Expo push token to the signed-in
// user - a token moves with whoever last signed in on that device.
router.post('/push-token', async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (typeof token !== 'string' || !/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
      return res.status(400).json({ error: 'token must be an Expo push token.' });
    }
    await pool.query(
      `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [token, req.accountUser.id, typeof platform === 'string' ? platform.slice(0, 20) : null]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/push-token', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [req.body.token, req.accountUser.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
