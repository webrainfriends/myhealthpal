require('dotenv').config();
const { Pool } = require('pg');
const registryData = require('./registry-seed-data');
const referenceRangeData = require('./reference-range-seed-data');
const { REFERENCE_SOURCE_FALLBACK } = require('../src/medications/citationSources');

async function seedRegistry(pool) {
  for (const entry of registryData) {
    const { rows } = await pool.query(
      `INSERT INTO health_parameters (code, display_name, category, data_type, canonical_unit, display_precision)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         category = EXCLUDED.category,
         data_type = EXCLUDED.data_type,
         canonical_unit = EXCLUDED.canonical_unit,
         display_precision = EXCLUDED.display_precision
       RETURNING id`,
      [entry.code, entry.displayName, entry.category, entry.dataType, entry.canonicalUnit, entry.displayPrecision]
    );
    const parameterId = rows[0].id;

    await pool.query('DELETE FROM parameter_aliases WHERE health_parameter_id = $1', [parameterId]);
    for (const alias of entry.aliases) {
      await pool.query(
        `INSERT INTO parameter_aliases (health_parameter_id, alias_text, source) VALUES ($1, $2, 'builtin')`,
        [parameterId, alias]
      );
    }

    await pool.query('DELETE FROM unit_conversions WHERE health_parameter_id = $1', [parameterId]);
    for (const conversion of entry.conversions) {
      await pool.query(
        `INSERT INTO unit_conversions (health_parameter_id, from_unit, to_unit, factor, offset_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [parameterId, conversion.fromUnit, entry.canonicalUnit, conversion.factor, conversion.offset]
      );
    }
  }
}

async function seedReferenceRanges(pool) {
  for (const entry of referenceRangeData) {
    const { rows } = await pool.query('SELECT id FROM health_parameters WHERE code = $1', [entry.parameterCode]);
    const parameterId = rows[0]?.id;
    if (!parameterId) {
      console.warn(`skip reference ranges for unknown parameter code: ${entry.parameterCode}`);
      continue;
    }

    for (const range of entry.ranges) {
      // A range can name its own more specific source_url (e.g. a page about
      // the exact guideline); otherwise it falls back to that source body's
      // own homepage - always a real, verified government/WHO URL, never a
      // guess (see citationSources.js).
      const sourceUrl = range.sourceUrl || REFERENCE_SOURCE_FALLBACK[range.source]?.url || null;
      await pool.query(
        `INSERT INTO reference_ranges (health_parameter_id, source, condition_label, range_low, range_high, unit, citation, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (health_parameter_id, source, condition_label) DO UPDATE SET
           range_low = EXCLUDED.range_low,
           range_high = EXCLUDED.range_high,
           unit = EXCLUDED.unit,
           citation = EXCLUDED.citation,
           source_url = EXCLUDED.source_url`,
        [parameterId, range.source, range.conditionLabel, range.low, range.high, entry.unit, range.citation, sourceUrl]
      );
    }
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await seedRegistry(pool);
  await seedReferenceRanges(pool);
  await pool.end();
  console.log('seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
