const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// Kept in sync with the CHECK constraint in migration 012 - validated here
// too so a bad value gets a 400 instead of surfacing as an opaque DB error.
const DIET_TYPES = ['vegetarian', 'vegan', 'non_vegetarian'];
const CUISINES = ['south_indian', 'north_indian', 'western', 'mediterranean', 'east_asian', 'middle_eastern'];

// Shown until a user saves their own selection (see migration 012's note on
// why this isn't seeded as rows).
const DEFAULT_DIET_TYPES = ['vegetarian', 'vegan'];
const DEFAULT_CUISINES = ['south_indian', 'western'];

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT preference_type, preference_value FROM user_recipe_preferences WHERE user_id = $1',
      [currentUserId(req)]
    );

    if (rows.length === 0) {
      return res.json({ dietTypes: DEFAULT_DIET_TYPES, cuisines: DEFAULT_CUISINES, isDefault: true });
    }

    const dietTypes = rows.filter((r) => r.preference_type === 'diet_type').map((r) => r.preference_value);
    const cuisines = rows.filter((r) => r.preference_type === 'cuisine').map((r) => r.preference_value);
    res.json({ dietTypes, cuisines, isDefault: false });
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const dietTypes = Array.isArray(req.body.dietTypes) ? req.body.dietTypes : [];
    const cuisines = Array.isArray(req.body.cuisines) ? req.body.cuisines : [];

    const invalidDietType = dietTypes.find((v) => !DIET_TYPES.includes(v));
    if (invalidDietType) {
      return res.status(400).json({ error: `Invalid diet type: ${invalidDietType}` });
    }
    const invalidCuisine = cuisines.find((v) => !CUISINES.includes(v));
    if (invalidCuisine) {
      return res.status(400).json({ error: `Invalid cuisine: ${invalidCuisine}` });
    }

    const userId = currentUserId(req);
    const values = [
      ...dietTypes.map((v) => ['diet_type', v]),
      ...cuisines.map((v) => ['cuisine', v]),
    ];

    await pool.query('DELETE FROM user_recipe_preferences WHERE user_id = $1', [userId]);
    if (values.length > 0) {
      const placeholders = values.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const params = [userId, ...values.flat()];
      await pool.query(
        `INSERT INTO user_recipe_preferences (user_id, preference_type, preference_value) VALUES ${placeholders}`,
        params
      );
    }

    res.json({ dietTypes, cuisines, isDefault: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
