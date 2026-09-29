const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const scheduleService = require('../src/dietSchedule/scheduleService');

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('schedule service test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM schedule_impact_flags WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedule_entries WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedules WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('createManualSchedule rejects a duration outside 7/15', async () => {
  await assert.rejects(
    () => scheduleService.createManualSchedule(userId, {
      title: 'Bad', durationDays: 10, startDate: '2026-02-01',
      entries: [{ dayNumber: 1, mealType: 'breakfast', dishName: 'Oats' }],
    }),
    (err) => err.status === 400
  );
});

test('createManualSchedule rejects an empty entries array and a day number outside the duration', async () => {
  await assert.rejects(
    () => scheduleService.createManualSchedule(userId, { title: 'Empty', durationDays: 7, startDate: '2026-02-01', entries: [] }),
    (err) => err.status === 400
  );

  await assert.rejects(
    () => scheduleService.createManualSchedule(userId, {
      title: 'Out of range', durationDays: 7, startDate: '2026-02-01',
      entries: [{ dayNumber: 9, mealType: 'breakfast', dishName: 'Oats' }],
    }),
    (err) => err.status === 400
  );
});

test('createManualSchedule computes scheduled_date from start_date + day_number - 1 and starts entries pending', async () => {
  const schedule = await scheduleService.createManualSchedule(userId, {
    title: 'Week One', durationDays: 7, startDate: '2026-02-01',
    entries: [
      { dayNumber: 1, mealType: 'breakfast', dishName: 'Idli' },
      { dayNumber: 3, mealType: 'dinner', dishName: 'Khichdi' },
    ],
  });

  assert.equal(schedule.source_type, 'manual');
  assert.equal(schedule.entries.length, 2);
  const day1 = schedule.entries.find((e) => e.dayNumber === 1);
  const day3 = schedule.entries.find((e) => e.dayNumber === 3);
  assert.equal(new Date(day1.scheduledDate).toISOString().slice(0, 10), '2026-02-01');
  assert.equal(new Date(day3.scheduledDate).toISOString().slice(0, 10), '2026-02-03');
  // recipe_status starts pending/generating/failed depending on how far the
  // in-process backfill got by the time this assertion runs (no
  // ANTHROPIC_API_KEY in the test environment, so it settles on 'failed')
  // - the key invariant is that it is never silently left without any recipe.
  assert.ok(['pending', 'generating', 'failed'].includes(day1.recipeStatus));
});

test('getScheduleWithEntries/listSchedules/deleteSchedule are scoped to the owning user', async () => {
  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other schedule user') RETURNING id`);
  try {
    const theirs = await scheduleService.createManualSchedule(other.rows[0].id, {
      title: 'Not Yours', durationDays: 7, startDate: '2026-02-01',
      entries: [{ dayNumber: 1, mealType: 'lunch', dishName: 'Something' }],
    });

    assert.equal(await scheduleService.getScheduleWithEntries(userId, theirs.id), null);

    const mine = await scheduleService.listSchedules(userId);
    assert.ok(!mine.some((s) => s.id === theirs.id));

    assert.equal(await scheduleService.deleteSchedule(userId, theirs.id), false);
  } finally {
    await pool.query('DELETE FROM diet_schedule_entries WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [other.rows[0].id]);
    await pool.query('DELETE FROM diet_schedules WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});

// createManualSchedule fires an in-process backfill (setImmediate) that, with
// no ANTHROPIC_API_KEY in this test environment, quickly settles an entry to
// 'failed'. Tests that then manually simulate a *successful* backfill (to
// observe updateEntry/logScheduleEntry's behavior on a generated recipe) must
// wait for that initial attempt to finish first, or it can race the manual
// override and flip the row back to 'failed' afterward.
async function waitUntilSettled(entryId) {
  for (let i = 0; i < 20; i += 1) {
    const { rows } = await pool.query('SELECT recipe_status FROM diet_schedule_entries WHERE id = $1', [entryId]);
    if (rows[0] && !['pending', 'generating'].includes(rows[0].recipe_status)) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('updateEntry resets the recipe when the dish name changes, but not for a meal-type-only edit', async () => {
  const schedule = await scheduleService.createManualSchedule(userId, {
    title: 'Edit Test', durationDays: 7, startDate: '2026-02-01',
    entries: [{ dayNumber: 2, mealType: 'lunch', dishName: 'Original Dish' }],
  });
  const entryId = schedule.entries[0].id;
  await waitUntilSettled(entryId);

  // Simulate a completed backfill so we can observe the reset.
  const { rows: recipeRows } = await pool.query(
    `INSERT INTO recipe_suggestions (user_id, title, ingredients, instructions) VALUES ($1, 'Original Dish', '[]', '[]') RETURNING id`,
    [userId]
  );
  await pool.query(`UPDATE diet_schedule_entries SET recipe_status = 'generated', recipe_suggestion_id = $1 WHERE id = $2`, [
    recipeRows[0].id,
    entryId,
  ]);

  const mealOnlyEdit = await scheduleService.updateEntry(userId, entryId, { mealType: 'dinner' });
  assert.equal(mealOnlyEdit.recipeStatus, 'generated');
  assert.ok(mealOnlyEdit.recipe);

  const dishEdit = await scheduleService.updateEntry(userId, entryId, { dishName: 'A Totally Different Dish' });
  assert.equal(dishEdit.dishName, 'A Totally Different Dish');
  assert.equal(dishEdit.recipeStatus, 'pending');
  assert.equal(dishEdit.recipe, null);
});

test('updateEntry rejects an empty dish name and an invalid meal type', async () => {
  const schedule = await scheduleService.createManualSchedule(userId, {
    title: 'Validation Test', durationDays: 7, startDate: '2026-02-01',
    entries: [{ dayNumber: 1, mealType: 'breakfast', dishName: 'Something' }],
  });
  const entryId = schedule.entries[0].id;

  await assert.rejects(() => scheduleService.updateEntry(userId, entryId, { dishName: '   ' }), (err) => err.status === 400);
  await assert.rejects(() => scheduleService.updateEntry(userId, entryId, { mealType: 'brunch' }), (err) => err.status === 400);
});

test('logScheduleEntry returns null until the entry has a generated recipe, then creates a food_entries row', async () => {
  const schedule = await scheduleService.createManualSchedule(userId, {
    title: 'Log Test', durationDays: 7, startDate: '2026-02-01',
    entries: [{ dayNumber: 1, mealType: 'breakfast', dishName: 'Poha' }],
  });
  const entryId = schedule.entries[0].id;
  await waitUntilSettled(entryId);

  assert.equal(await scheduleService.logScheduleEntry(userId, entryId, {}), null);

  const { rows: recipeRows } = await pool.query(
    `INSERT INTO recipe_suggestions (user_id, title, meal_type, ingredients, instructions) VALUES ($1, 'Poha', 'breakfast', '[]', '[]') RETURNING id`,
    [userId]
  );
  await pool.query(`UPDATE diet_schedule_entries SET recipe_status = 'generated', recipe_suggestion_id = $1 WHERE id = $2`, [
    recipeRows[0].id,
    entryId,
  ]);

  const foodEntry = await scheduleService.logScheduleEntry(userId, entryId, { consumedAt: new Date('2026-02-01T08:00:00Z') });
  assert.equal(foodEntry.name, 'Poha');

  const updatedSchedule = await scheduleService.getScheduleWithEntries(userId, schedule.id);
  assert.equal(updatedSchedule.entries[0].foodEntryId, foodEntry.id);
});
