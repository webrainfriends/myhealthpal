// Re-runs unit normalization over results saved before the unit fixes
// (spelling variants like "m2" / "/cumm" / "µL", and units that cannot belong
// to the test such as "%" on AST/ALT). Only touches mapped, numeric results
// that have no normalized unit yet; idempotent, prints counts only.
//
//   node scripts/repair-measurement-units.js
const pool = require('../src/db/pool');
const registry = require('../src/extraction/registry');

async function main() {
  const { rows } = await pool.query(
    `SELECT hm.id, hm.numeric_value, hm.raw_unit, hp.id AS parameter_id, hp.canonical_unit
     FROM health_measurements hm
     JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE hm.normalized_unit IS NULL AND hm.numeric_value IS NOT NULL
       AND hm.raw_unit IS NOT NULL AND hp.canonical_unit IS NOT NULL`
  );

  let converted = 0;
  let corrected = 0;
  for (const row of rows) {
    const parameter = { id: row.parameter_id, canonical_unit: row.canonical_unit };
    const conversion = await registry.convertToCanonicalUnit(parameter, Number(row.numeric_value), row.raw_unit);
    if (conversion) {
      await pool.query(
        `UPDATE health_measurements
         SET normalized_value = $2, normalized_unit = $3, normalization_confidence = 1.0, updated_at = now()
         WHERE id = $1`,
        [row.id, conversion.normalizedValue, conversion.normalizedUnit]
      );
      converted += 1;
    } else if (!(await registry.isUnitPlausible(parameter, row.raw_unit))) {
      // Unit from a neighbouring column: take the value as canonical and
      // leave the result flagged for a person to confirm.
      await pool.query(
        `UPDATE health_measurements
         SET normalized_value = numeric_value, normalized_unit = $2, normalization_confidence = 0.6,
             needs_review = true, updated_at = now()
         WHERE id = $1`,
        [row.id, row.canonical_unit]
      );
      corrected += 1;
    }
  }
  console.log(`unit repair: ${rows.length} unnormalized, ${converted} converted, ${corrected} corrected`);
}

main()
  .catch((err) => {
    console.error('unit repair failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
