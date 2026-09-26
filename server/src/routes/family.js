const express = require('express');
const familyService = require('../services/familyService');

const router = express.Router();

// Family management always belongs to the signed-in account itself
// (req.accountUser), never to a profile it's currently acting as via
// X-Profile-Id - otherwise a caregiver viewing Dad could add members to
// Dad's family, or share Dad's access onward from a view-only link.
function account(req) {
  return req.accountUser;
}

router.get('/', async (req, res, next) => {
  try {
    const [profiles, sharedWith] = await Promise.all([
      familyService.listProfiles(account(req)),
      familyService.listSharedWith(account(req).id),
    ]);
    res.json({ profiles, sharedWith });
  } catch (err) {
    next(err);
  }
});

router.post('/members', async (req, res, next) => {
  try {
    const member = await familyService.createManagedProfile(account(req), req.body);
    res.status(201).json({ profile: { id: member.id, displayName: member.display_name } });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/members/:id', async (req, res, next) => {
  try {
    const link = await familyService.updateMember(account(req).id, req.params.id, req.body);
    if (!link) return res.status(404).json({ error: 'Family member not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/members/:id', async (req, res, next) => {
  try {
    const result = await familyService.removeMember(account(req).id, req.params.id);
    if (!result.removed) return res.status(404).json({ error: 'Family member not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Revokes another account's access to this account's own profile.
router.delete('/shared-with/:userId', async (req, res, next) => {
  try {
    const revoked = await familyService.revokeSharedWith(account(req).id, req.params.userId);
    if (!revoked) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// { profileId?, access: 'manage' | 'view', relation? } - profileId defaults
// to the account's own profile.
router.post('/invites', async (req, res, next) => {
  try {
    const invite = await familyService.createInvite(account(req), req.body);
    if (!invite) return res.status(403).json({ error: 'You can only share profiles you manage.' });
    res.status(201).json({ invite });
  } catch (err) {
    next(err);
  }
});

router.post('/invites/redeem', async (req, res, next) => {
  try {
    const result = await familyService.redeemInvite(account(req), req.body.code);
    if (result.error) return res.status(400).json({ error: result.error });
    const profiles = await familyService.listProfiles(account(req));
    res.json({ profile: profiles.find((p) => p.id === result.memberId) || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
