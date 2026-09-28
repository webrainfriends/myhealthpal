const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const kitchenService = require('../src/kitchen/kitchenService');

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('kitchen service test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM kitchen_items WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('upsertKitchenItem creates a new item, then updates the same one by name instead of duplicating', async () => {
  const created = await kitchenService.upsertKitchenItem(userId, {
    name: 'Onion', category: 'vegetable', quantityAmount: 3, quantityUnit: 'piece',
  });
  assert.equal(created.category, 'vegetable');

  const updated = await kitchenService.upsertKitchenItem(userId, {
    name: 'Onion', category: 'vegetable', quantityAmount: 6, quantityUnit: 'piece',
  });
  assert.equal(updated.id, created.id);
  assert.equal(Number(updated.quantity_amount), 6);

  const all = await kitchenService.listKitchenItems(userId, {});
  assert.equal(all.filter((i) => i.name === 'Onion').length, 1);
});

test('listKitchenItems filters by category and search', async () => {
  await kitchenService.upsertKitchenItem(userId, { name: 'Rice', category: 'grain' });
  await kitchenService.upsertKitchenItem(userId, { name: 'Red Lentils', category: 'legume' });

  const grains = await kitchenService.listKitchenItems(userId, { category: 'grain' });
  assert.deepEqual(grains.map((i) => i.name), ['Rice']);

  const searched = await kitchenService.listKitchenItems(userId, { search: 'lentil' });
  assert.deepEqual(searched.map((i) => i.name), ['Red Lentils']);
});

test('setting is_available=false via updateKitchenItem excludes it from availableOnly and fetchAvailableKitchenItems', async () => {
  const item = await kitchenService.upsertKitchenItem(userId, { name: 'Garlic', category: 'vegetable' });
  await kitchenService.updateKitchenItem(userId, item.id, { isAvailable: false });

  const availableOnly = await kitchenService.listKitchenItems(userId, { availableOnly: true });
  assert.ok(!availableOnly.some((i) => i.name === 'Garlic'));

  const resolved = await kitchenService.fetchAvailableKitchenItems(userId, [item.id]);
  assert.equal(resolved.length, 0);
});

test('fetchAvailableKitchenItems never resolves another user\'s item id', async () => {
  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other kitchen user') RETURNING id`);
  try {
    const theirItem = await kitchenService.upsertKitchenItem(other.rows[0].id, { name: 'Their Item', category: 'other' });
    const resolved = await kitchenService.fetchAvailableKitchenItems(userId, [theirItem.id]);
    assert.equal(resolved.length, 0);
  } finally {
    await pool.query('DELETE FROM kitchen_items WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});

test('deleteKitchenItem removes only the caller\'s own item', async () => {
  const item = await kitchenService.upsertKitchenItem(userId, { name: 'Spinach', category: 'vegetable' });
  const deleted = await kitchenService.deleteKitchenItem(userId, item.id);
  assert.equal(deleted, true);

  const again = await kitchenService.deleteKitchenItem(userId, item.id);
  assert.equal(again, false);
});
