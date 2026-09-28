const pool = require('../db/pool');

// The "mini kitchen": a per-user pantry list (025_kitchen_items.sql) that
// scheduleGenerationService.js draws from when generating a diet schedule
// constrained to what the person actually has on hand. Kept as a small
// service (rather than inline in routes/kitchen.js, the way the simpler
// pinnedParameters/recipePreferences routes do their own queries) because
// scheduleGenerationService.js needs the same "resolve these ids to real,
// available items" read that the route also needs.

const CATEGORIES = ['vegetable', 'fruit', 'grain', 'legume', 'dairy', 'protein', 'spice', 'condiment', 'other'];
const QUANTITY_UNITS = ['g', 'ml', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other'];

function isValidCategory(value) {
  return CATEGORIES.includes(value);
}

function isValidQuantityUnit(value) {
  return value == null || QUANTITY_UNITS.includes(value);
}

async function listKitchenItems(userId, { category, search, availableOnly } = {}) {
  const conditions = ['user_id = $1'];
  const params = [userId];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (availableOnly) {
    conditions.push('is_available = true');
  }

  const { rows } = await pool.query(
    `SELECT * FROM kitchen_items WHERE ${conditions.join(' AND ')} ORDER BY category ASC, name ASC`,
    params
  );
  return rows;
}

// Adds a new item, or updates the existing one of the same name (a person
// re-adding "onions" edits the quantity/category rather than creating a
// duplicate row) - the UNIQUE (user_id, name) constraint backs this.
async function upsertKitchenItem(userId, { name, category, quantityAmount, quantityUnit, isAvailable }) {
  const { rows } = await pool.query(
    `INSERT INTO kitchen_items (user_id, name, category, quantity_amount, quantity_unit, is_available)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
     ON CONFLICT (user_id, name) DO UPDATE SET
       category = EXCLUDED.category,
       quantity_amount = EXCLUDED.quantity_amount,
       quantity_unit = EXCLUDED.quantity_unit,
       is_available = COALESCE($6, kitchen_items.is_available),
       updated_at = now()
     RETURNING *`,
    [userId, name.trim(), category, quantityAmount ?? null, quantityUnit ?? null, isAvailable ?? null]
  );
  return rows[0];
}

async function updateKitchenItem(userId, itemId, patch) {
  const { rows: existingRows } = await pool.query('SELECT * FROM kitchen_items WHERE id = $1 AND user_id = $2', [
    itemId,
    userId,
  ]);
  const existing = existingRows[0];
  if (!existing) return null;

  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
    category: patch.category !== undefined ? patch.category : existing.category,
    quantity_amount: patch.quantityAmount !== undefined ? patch.quantityAmount : existing.quantity_amount,
    quantity_unit: patch.quantityUnit !== undefined ? patch.quantityUnit : existing.quantity_unit,
    is_available: patch.isAvailable !== undefined ? patch.isAvailable : existing.is_available,
  };

  const { rows } = await pool.query(
    `UPDATE kitchen_items SET name = $1, category = $2, quantity_amount = $3, quantity_unit = $4, is_available = $5, updated_at = now()
     WHERE id = $6 RETURNING *`,
    [next.name, next.category, next.quantity_amount, next.quantity_unit, next.is_available, itemId]
  );
  return rows[0];
}

async function deleteKitchenItem(userId, itemId) {
  const { rows } = await pool.query('DELETE FROM kitchen_items WHERE id = $1 AND user_id = $2 RETURNING id', [
    itemId,
    userId,
  ]);
  return rows.length > 0;
}

// Resolves a set of selected ids into real, currently-available items -
// used by scheduleGenerationService.js so a stale/removed selection can
// never smuggle an item the person no longer has into a generation prompt.
async function fetchAvailableKitchenItems(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT * FROM kitchen_items WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_available = true`,
    [userId, ids]
  );
  return rows;
}

module.exports = {
  CATEGORIES,
  QUANTITY_UNITS,
  isValidCategory,
  isValidQuantityUnit,
  listKitchenItems,
  upsertKitchenItem,
  updateKitchenItem,
  deleteKitchenItem,
  fetchAvailableKitchenItems,
};
