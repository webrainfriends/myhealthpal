require('dotenv').config();
const { Pool } = require('pg');

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `INSERT INTO users (id, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_USER_ID, 'demo@myhealthpal.app', 'Demo User']
  );
  await pool.end();
  console.log('seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
