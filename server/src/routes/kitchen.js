const express = require('express');
const kitchenService = require('../kitchen/kitchenService');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/items', async (req, res, next) => {
  try {
    const items = await kitchenService.listKitchenItems(currentUserId(req), {
      category: req.query.category || null,
      search: req.query.search || null,
      availableOnly: req.query.available_only === 'true',
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/items', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: 'name is required.' });
    if (!kitchenService.isValidCategory(body.category)) {
      return res.status(400).json({ error: `category must be one of ${kitchenService.CATEGORIES.join(', ')}.` });
    }
    if (!kitchenService.isValidQuantityUnit(body.quantity_unit)) {
      return res.status(400).json({ error: `quantity_unit must be one of ${kitchenService.QUANTITY_UNITS.join(', ')}.` });
    }

    const item = await kitchenService.upsertKitchenItem(currentUserId(req), {
      name: body.name,
      category: body.category,
      quantityAmount: body.quantity_amount ?? null,
      quantityUnit: body.quantity_unit ?? null,
      isAvailable: body.is_available ?? null,
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.category !== undefined && !kitchenService.isValidCategory(body.category)) {
      return res.status(400).json({ error: `category must be one of ${kitchenService.CATEGORIES.join(', ')}.` });
    }
    if (body.quantity_unit !== undefined && !kitchenService.isValidQuantityUnit(body.quantity_unit)) {
      return res.status(400).json({ error: `quantity_unit must be one of ${kitchenService.QUANTITY_UNITS.join(', ')}.` });
    }

    const item = await kitchenService.updateKitchenItem(currentUserId(req), req.params.id, {
      name: body.name,
      category: body.category,
      quantityAmount: body.quantity_amount,
      quantityUnit: body.quantity_unit,
      isAvailable: body.is_available,
    });
    if (!item) return res.status(404).json({ error: 'Kitchen item not found.' });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', async (req, res, next) => {
  try {
    const deleted = await kitchenService.deleteKitchenItem(currentUserId(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Kitchen item not found.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
