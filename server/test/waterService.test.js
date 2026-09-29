const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const waterService = require('../src/water/waterService');

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('water service test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM water_entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('logWaterEntry rejects non-positive and over-cap amounts', async () => {
  await assert.rejects(() => waterService.logWaterEntry(userId, { amountMl: 0 }), (err) => err.status === 400);
  await assert.rejects(() => waterService.logWaterEntry(userId, { amountMl: -250 }), (err) => err.status === 400);
  await assert.rejects(() => waterService.logWaterEntry(userId, { amountMl: 6000 }), (err) => err.status === 400);
});

test('logWaterEntry accepts the quick-add amounts and getDaySummary totals them for the right day', async () => {
  const loggedAt = new Date('2026-03-10T08:00:00.000Z');
  await waterService.logWaterEntry(userId, { amountMl: 250, loggedAt });
  await waterService.logWaterEntry(userId, { amountMl: 500, loggedAt: new Date('2026-03-10T12:00:00.000Z') });
  await waterService.logWaterEntry(userId, { amountMl: 1000, loggedAt: new Date('2026-03-10T18:00:00.000Z') });
  await waterService.logWaterEntry(userId, { amountMl: 2000, loggedAt: new Date('2026-03-11T08:00:00.000Z') }); // different day

  const day10 = await waterService.getDaySummary(userId, '2026-03-10');
  assert.equal(day10.entries.length, 3);
  assert.equal(day10.totalMl, 1750);

  const day11 = await waterService.getDaySummary(userId, '2026-03-11');
  assert.equal(day11.entries.length, 1);
  assert.equal(day11.totalMl, 2000);
});

test('deleteWaterEntry only removes the caller\'s own entry', async () => {
  const entry = await waterService.logWaterEntry(userId, { amountMl: 250, loggedAt: new Date('2026-03-12T08:00:00.000Z') });

  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other water user') RETURNING id`);
  try {
    assert.equal(await waterService.deleteWaterEntry(other.rows[0].id, entry.id), false);
    assert.equal(await waterService.deleteWaterEntry(userId, entry.id), true);
    assert.equal(await waterService.deleteWaterEntry(userId, entry.id), false); // already gone
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});
