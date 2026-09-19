require('dotenv').config();
const { Pool } = require('pg');
const registryData = require('./registry-seed-data');

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

async function seedDemoUser(pool) {
  await pool.query(
    `INSERT INTO users (id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_USER_ID, 'demo@myhealthpal.app', 'Demo User']
  );
}

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

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await seedDemoUser(pool);
  await seedRegistry(pool);
  await pool.end();
  console.log('seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
