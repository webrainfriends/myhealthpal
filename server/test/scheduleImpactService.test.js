const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const scheduleImpactService = require('../src/dietSchedule/scheduleImpactService');

// config.dietProvider defaults to 'heuristic' in this test environment (no
// DIET_PROVIDER/ANTHROPIC_API_KEY set), so finalizeTips always takes its
// deterministic path - no Anthropic mocking needed to exercise the
// worsens/improves classification itself.

let userId;

async function makeSchedule(durationDays) {
  const { rows } = await pool.query(
    `INSERT INTO diet_schedules (user_id, title, duration_days, start_date, source_type) VALUES ($1, 'Impact Test', $2, '2026-03-01', 'manual') RETURNING id`,
    [userId, durationDays]
  );
  return rows[0].id;
}

async function addGeneratedEntry(scheduleId, dayNumber, nutrients) {
  const { rows: recipeRows } = await pool.query(
    `INSERT INTO recipe_suggestions (
       user_id, title, meal_type, ingredients, instructions,
       calories, protein_g, carbs_g, fat_g, saturated_fat_g, fiber_g, sugar_g,
       sodium_mg, cholesterol_mg, potassium_mg, calcium_mg, iron_mg, vitamin_d_mcg
     ) VALUES ($1, 'Test Recipe', 'lunch', '[]', '[]', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      userId, nutrients.calories ?? 0, nutrients.protein_g ?? 0, nutrients.carbs_g ?? 0, nutrients.fat_g ?? 0,
      nutrients.saturated_fat_g ?? 0, nutrients.fiber_g ?? 0, nutrients.sugar_g ?? 0, nutrients.sodium_mg ?? 0,
      nutrients.cholesterol_mg ?? 0, nutrients.potassium_mg ?? 0, nutrients.calcium_mg ?? 0, nutrients.iron_mg ?? 0,
      nutrients.vitamin_d_mcg ?? 0,
    ]
  );
  await pool.query(
    `INSERT INTO diet_schedule_entries (schedule_id, day_number, scheduled_date, meal_type, dish_name, recipe_suggestion_id, recipe_status)
     VALUES ($1, $2, '2026-03-01', 'lunch', 'Test Recipe', $3, 'generated')`,
    [scheduleId, dayNumber, recipeRows[0].id]
  );
}

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('impact test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM schedule_impact_flags WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedule_entries WHERE schedule_id IN (SELECT id FROM diet_schedules WHERE user_id = $1)', [userId]);
  await pool.query('DELETE FROM diet_schedules WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM medications WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('computeScheduleAggregate returns null when no entry has a generated recipe yet', async () => {
  const scheduleId = await makeSchedule(7);
  const aggregate = await scheduleImpactService.computeScheduleAggregate(scheduleId);
  assert.equal(aggregate, null);
});

test('computeScheduleAggregate averages nutrition per day across the whole duration, not just logged days', async () => {
  const scheduleId = await makeSchedule(7);
  // Only 1 of 7 days has a recipe - the average must still divide by the
  // full 7-day duration (the planned schedule), not by 1.
  await addGeneratedEntry(scheduleId, 1, { sodium_mg: 3500 });

  const aggregate = await scheduleImpactService.computeScheduleAggregate(scheduleId);
  assert.equal(aggregate.entriesWithRecipeCount, 1);
  assert.equal(aggregate.avgDailySodiumMg, 500); // 3500 / 7
});

test('computeImpactFlags flags a high-sodium schedule as worsening blood pressure when the user has a matching abnormal lab', async () => {
  const scheduleId = await makeSchedule(7);
  // 7 entries averaging well above the 2300mg/day sodium guideline.
  for (let day = 1; day <= 7; day += 1) {
    // eslint-disable-next-line no-await-in-loop
    await addGeneratedEntry(scheduleId, day, { sodium_mg: 3000 });
  }

  const { rows: paramRows } = await pool.query(`SELECT id FROM health_parameters WHERE code = 'sodium'`);
  const { rows: reportRows } = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status)
     VALUES ($1, 'test.pdf', 'application/pdf', 'pdf', 10, '/tmp/x', 'Completed') RETURNING id`,
    [userId]
  );
  await pool.query(
    `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, value_type, status_flag, is_confirmed)
     VALUES ($1, $2, 'Sodium', '150', 'numeric', 'High', true)`,
    [reportRows[0].id, paramRows[0].id]
  );

  try {
    const result = await scheduleImpactService.computeImpactFlags(userId, scheduleId);
    assert.ok(result.worsens.some((w) => w.key === 'bloodPressure'));
    assert.ok(!result.improves.some((i) => i.key === 'bloodPressure'));
    assert.equal(result.provider, 'heuristic');
  } finally {
    await pool.query('DELETE FROM health_measurements WHERE report_id = $1', [reportRows[0].id]);
    await pool.query('DELETE FROM reports WHERE id = $1', [reportRows[0].id]);
  }
});

test('getOrComputeImpactFlags is cached until the generated-recipe count changes', async () => {
  const scheduleId = await makeSchedule(7);
  await addGeneratedEntry(scheduleId, 1, { sodium_mg: 100 });

  const first = await scheduleImpactService.getOrComputeImpactFlags(userId, scheduleId);
  const second = await scheduleImpactService.getOrComputeImpactFlags(userId, scheduleId);
  assert.equal(first.id, second.id);
  assert.equal(first.generated_at.getTime(), second.generated_at.getTime());

  await addGeneratedEntry(scheduleId, 2, { sodium_mg: 100 });
  const third = await scheduleImpactService.getOrComputeImpactFlags(userId, scheduleId);
  assert.notEqual(third.generated_at.getTime(), first.generated_at.getTime());
  assert.equal(third.entries_with_recipe_count, 2);
});
