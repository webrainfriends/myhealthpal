const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

// Regression test for a real "wrong day shown" bug: pg's default parser
// turns a DATE column into a JS Date object at UTC midnight. Once that
// round-trips through JSON and a mobile client re-parses/re-localizes it,
// anyone in a timezone behind UTC (all of the Americas) sees the previous
// day. db/pool.js now overrides the DATE (OID 1082) type parser to return
// the raw 'YYYY-MM-DD' string unchanged, removing that round-trip - see its
// comment, and mobile/src/utils/date.js for the client-side half of the fix.
test.after(async () => {
  await pool.end();
});

test('a DATE column comes back as a plain YYYY-MM-DD string, not a Date object', async () => {
  const { rows } = await pool.query(`SELECT '2026-09-01'::date AS d`);
  assert.equal(typeof rows[0].d, 'string');
  assert.equal(rows[0].d, '2026-09-01');
});

test('a TIMESTAMPTZ column is unaffected - still a real Date object', async () => {
  const { rows } = await pool.query(`SELECT now() AS ts`);
  assert.ok(rows[0].ts instanceof Date);
});
