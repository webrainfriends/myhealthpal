const express = require('express');
const oauthService = require('../oauth/service');

const router = express.Router();

// AI apps (Claude, ChatGPT) the signed-in account has connected through the
// MCP connector. Account-level on purpose: a grant belongs to the person who
// authorised it, whichever family profile they happen to be viewing.
router.get('/', async (req, res, next) => {
  try {
    const grants = await oauthService.listGrants(req.accountUser.id);
    res.json({
      apps: grants.map((g) => ({
        id: g.id,
        name: g.client_name,
        scopes: g.scopes,
        connectedAt: g.created_at,
        lastUsedAt: g.last_used_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await oauthService.revokeUserGrant(req.accountUser.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Connected app not found.' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
