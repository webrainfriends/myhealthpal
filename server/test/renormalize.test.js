const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { renormalize } = require('../src/services/renormalizeService');

let userId;
let ids;

async function row(id) {
  return (await pool.query('SELECT * FROM health_measurements WHERE id = $1', [id])).rows[0];
}

test.before(async () => {
  userId = (await pool.query(`INSERT INTO users (email, display_name) VALUES ('renormalize-test@example.com', 'RN') RETURNING id`)).rows[0].id;
  const reportId = (
    await pool.query(
      `INSERT INTO reports (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, ingestion_status)
       VALUES ($1, 'r.pdf', 'application/pdf', 'pdf', 1, '/tmp/r', 'Needs Review') RETURNING id`,
      [userId]
    )
  ).rows[0].id;
  const add = async (name, value, unit, extra = {}) =>
    (
      await pool.query(
        `INSERT INTO health_measurements (report_id, raw_test_name, raw_value, raw_unit, value_type, numeric_value, needs_review,
           extraction_confidence, is_confirmed)
         VALUES ($1, $2, $3, $4, 'numeric', $7, $5, 0.9, $6) RETURNING id`,
        [reportId, name, value, unit, extra.review ?? true, extra.confirmed ?? false, Number(value)]
      )
    ).rows[0].id;
  ids = {
    ratio: await add('AST/ALT Ratio (SGOT/SGPT)', '1.2', '%'), // stored unmapped (ambiguous), flagged
    platelets: await add('Platelet Count', '2.5', 'lakhs/cumm'), // mapped by the old rules but never converted
    edited: await add('TC/HDL Ratio', '3.9', null), // a person already corrected this one
    confirmedUnmapped: await add('Some Odd Marker', '5', 'U/L', { review: false, confirmed: true }), // confirmed by the user
  };
  await pool.query(
    `INSERT INTO measurement_corrections (measurement_id, field_name, previous_value, new_value, corrected_by)
     VALUES ($1, 'raw_value', '3.8', '3.9', $2)`,
    [ids.edited, userId]
  );
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('a dry run reports what would change and writes nothing', async () => {
  const stats = await renormalize({ dryRun: true, userId });
  assert.ok(stats.changed >= 2);
  assert.equal(stats.skippedEdited, 1);
  assert.equal((await row(ids.ratio)).health_parameter_id, null);
  assert.equal((await row(ids.platelets)).normalized_unit, null);
});

test('renormalizing fixes mapping, units and review flags, skips edited rows, and is idempotent', async () => {
  const stats = await renormalize({ dryRun: false, userId });
  assert.ok(stats.remapped >= 1);
  assert.ok(stats.reviewCleared >= 1);

  const ratio = await row(ids.ratio);
  assert.ok(ratio.health_parameter_id); // no longer ambiguous
  assert.equal(ratio.ambiguous_candidate_ids, null);
  assert.equal(ratio.normalized_unit, null);
  assert.equal(ratio.raw_unit, '%'); // the extraction itself is untouched
  assert.equal(ratio.needs_review, false);

  const platelets = await row(ids.platelets);
  assert.equal(platelets.normalized_unit, '10^3/uL');
  assert.equal(Number(platelets.normalized_value), 250);

  const edited = await row(ids.edited);
  assert.equal(edited.health_parameter_id, null); // left exactly as the person had it
  assert.equal(edited.needs_review, true);

  // A confirmed result is never put back into review.
  const confirmed = await row(ids.confirmedUnmapped);
  assert.equal(confirmed.needs_review, false);

  const again = await renormalize({ dryRun: false, userId });
  assert.equal(again.changed, 0);
});
