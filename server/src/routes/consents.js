const express = require('express');
const consentService = require('../security/consentService');

const router = express.Router();

// Consents belong to the data subject: the signed-in account itself, or a
// *managed* family profile it looks after (a parent without their own
// login), for whom the caregiver decides. Another adult with their own
// account always decides for themselves - a caregiver can view their
// consent state but never change it.
function canDecideFor(req) {
  return req.user.id === req.accountUser.id || req.user.auth_provider === 'managed';
}

router.get('/', async (req, res, next) => {
  try {
    const consents = await consentService.getConsents(req.user.id);
    res.json({
      subjectUserId: req.user.id,
      policyVersion: consentService.POLICY_VERSION,
      canEdit: canDecideFor(req),
      consents,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:type', async (req, res, next) => {
  try {
    if (!consentService.CONSENT_TYPES[req.params.type]) {
      return res.status(400).json({ error: 'Unknown consent type.' });
    }
    if (typeof req.body.granted !== 'boolean') {
      return res.status(400).json({ error: 'granted must be true or false.' });
    }
    if (!canDecideFor(req)) {
      return res.status(403).json({ error: 'Only this person can change their own privacy choices.' });
    }
    const consents = await consentService.setConsent({
      userId: req.user.id,
      consentType: req.params.type,
      granted: req.body.granted,
      grantedBy: req.accountUser.id,
      sourcePlatform: typeof req.body.platform === 'string' ? req.body.platform.slice(0, 20) : null,
    });
    res.json({ subjectUserId: req.user.id, policyVersion: consentService.POLICY_VERSION, canEdit: true, consents });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
