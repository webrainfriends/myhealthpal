const express = require('express');
const registry = require('../extraction/registry');

const router = express.Router();

// Backs the "pick the correct canonical mapping" UI for unmapped/ambiguous
// measurements.
router.get('/', async (req, res, next) => {
  try {
    const parameters = await registry.searchParameters(req.query.search || '', 25);
    res.json({ parameters });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
