const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const waterTargetService = require('../src/water/waterTargetService');

// config.dietProvider defaults to 'heuristic' in this test environment, so
// finalizeSummary always takes its deterministic path - no Anthropic
// mocking needed to exercise the min/ideal/max computation itself.

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('water target test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM water_targets WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_weight_goals WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM medications WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('computeTarget falls back to general adult guidelines with no weight on file', async () => {
  const target = await waterTargetService.computeTarget(userId);
  assert.equal(target.min, 2000);
  assert.equal(target.ideal, 2500);
  assert.equal(target.max, 3500);
  assert.equal(target.weightKg, null);
  assert.match(target.heuristicSummary, /general adult guideline/);
});

test('computeTarget scales min/ideal/max from recorded body weight (ml/kg)', async () => {
  await pool.query('INSERT INTO user_weight_goals (user_id, current_weight_kg) VALUES ($1, 70)', [userId]);
  const target = await waterTargetService.computeTarget(userId);
  assert.equal(target.min, 1750); // 70 * 25
  assert.equal(target.ideal, 2310); // 70 * 33
  assert.equal(target.max, 3150); // 70 * 45
  assert.equal(target.weightKg, 70);
  await pool.query('DELETE FROM user_weight_goals WHERE user_id = $1', [userId]);
});

test('an abnormal kidney-relevant lab caps the max well below the weight-based figure', async () => {
  await pool.query('INSERT INTO user_weight_goals (user_id, current_weight_kg) VALUES ($1, 90)', [userId]);
  const { rows: paramRows } = await pool.query(`SELECT id FROM health_parameters WHERE code = 'creatinine'`);
  const { rows: reportRows } = await pool.query(
    `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status)
     VALUES ($1, 'test.pdf', 'application/pdf', 'pdf', 10, '/tmp/x', 'Completed') RETURNING id`,
    [userId]
  );
  await pool.query(
    `INSERT INTO health_measurements (report_id, health_parameter_id, raw_test_name, raw_value, value_type, status_flag, is_confirmed)
     VALUES ($1, $2, 'Creatinine', '2.1', 'numeric', 'High', true)`,
    [reportRows[0].id, paramRows[0].id]
  );

  try {
    const target = await waterTargetService.computeTarget(userId);
    assert.ok(target.max <= 2000, `expected a conservative max, got ${target.max}`);
    assert.ok(target.evidence.kidneyCaution);
    assert.match(target.heuristicSummary, /doctor/);
  } finally {
    await pool.query('DELETE FROM health_measurements WHERE report_id = $1', [reportRows[0].id]);
    await pool.query('DELETE FROM reports WHERE id = $1', [reportRows[0].id]);
    await pool.query('DELETE FROM user_weight_goals WHERE user_id = $1', [userId]);
  }
});

test('evaluateIntake flags under, ok, and over relative to the target band', () => {
  const target = { min_ml: 2000, max_ml: 3000 };
  assert.equal(waterTargetService.evaluateIntake(1000, target).status, 'under');
  assert.equal(waterTargetService.evaluateIntake(2500, target).status, 'ok');

  const over = waterTargetService.evaluateIntake(4000, target);
  assert.equal(over.status, 'over');
  assert.match(over.message, /1000ml over/); // cites the amount over the max (4000-3000), not the raw total
});

test('getOrGenerateWaterTarget caches for the day and regenerates when weight changes', async () => {
  const first = await waterTargetService.getOrGenerateWaterTarget(userId);
  const second = await waterTargetService.getOrGenerateWaterTarget(userId);
  assert.equal(first.id, second.id);
  assert.equal(first.generated_at.getTime(), second.generated_at.getTime());

  await pool.query('INSERT INTO user_weight_goals (user_id, current_weight_kg) VALUES ($1, 60) ON CONFLICT (user_id) DO UPDATE SET current_weight_kg = 60', [userId]);
  const third = await waterTargetService.getOrGenerateWaterTarget(userId);
  assert.notEqual(third.generated_at.getTime(), first.generated_at.getTime());
  assert.equal(Number(third.weight_kg_considered), 60);

  await pool.query('DELETE FROM user_weight_goals WHERE user_id = $1', [userId]);
});
