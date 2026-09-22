const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { groupTestNames, normalizeTestNameKey, classifyHeuristically } = require('../src/services/customCardService');

// customCardProvider defaults to 'heuristic' (see config.js) unless
// CUSTOM_CARD_PROVIDER=claude is set - these tests exercise that default
// path only, so they never need network access or an API key.

test.after(async () => {
  await pool.query(`DELETE FROM custom_parameter_groups WHERE test_name_key LIKE 'test-fixture-%'`);
  await pool.end();
});

test('normalizeTestNameKey lowercases and collapses whitespace', () => {
  assert.equal(normalizeTestNameKey('  A/G   Ratio '), 'a/g ratio');
});

test('classifyHeuristically groups recognizable protein-family tests together', () => {
  assert.equal(classifyHeuristically('albumin').label, 'Proteins');
  assert.equal(classifyHeuristically('a/g ratio').label, 'Proteins');
  assert.equal(classifyHeuristically('globulin').label, 'Proteins');
});

test('classifyHeuristically falls back to "Other Results" for nothing it recognizes', () => {
  assert.equal(classifyHeuristically('test-fixture-totally unknown xyz').label, 'Other Results');
});

test('groupTestNames covers every distinct name given, never dropping one', async () => {
  const names = [
    'test-fixture-Albumin',
    'test-fixture-A/G Ratio',
    'test-fixture-Some Unrecognized Marker',
  ];
  const result = await groupTestNames(names);

  for (const name of names) {
    const entry = result.get(normalizeTestNameKey(name));
    assert.ok(entry, `expected a group for "${name}"`);
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0);
  }
});

test('groupTestNames includes a description for every group, never just a bare label', async () => {
  const name = 'test-fixture-Vitamin D';
  const result = await groupTestNames([name]);
  const entry = result.get(normalizeTestNameKey(name));
  assert.equal(typeof entry.description, 'string');
  assert.ok(entry.description.length > 0);
});

test('groupTestNames caches separately per language, without needing a live translation', async () => {
  // No ANTHROPIC_API_KEY is configured in this test env, so a non-English
  // request still resolves (via the English-only heuristic fallback - see
  // customCardService.js's top comment) and, crucially, is cached under
  // its own language rather than colliding with the English cache row.
  const name = 'test-fixture-Albumin Multilingual';
  const en = await groupTestNames([name], 'en');
  const es = await groupTestNames([name], 'es');
  assert.equal(en.get(normalizeTestNameKey(name)).label, 'Proteins');
  assert.equal(es.get(normalizeTestNameKey(name)).label, 'Proteins');

  const { rows } = await pool.query(
    `SELECT language FROM custom_parameter_groups WHERE test_name_key = $1 ORDER BY language`,
    [normalizeTestNameKey(name)]
  );
  assert.deepEqual(rows.map((r) => r.language), ['en', 'es']);
});

test('groupTestNames caches a classification and reuses it on the next call', async () => {
  const name = 'test-fixture-Ferritin Repeat Check';
  const first = await groupTestNames([name]);
  const { rows: afterFirst } = await pool.query(
    `SELECT * FROM custom_parameter_groups WHERE test_name_key = $1`,
    [normalizeTestNameKey(name)]
  );
  assert.equal(afterFirst.length, 1);

  const second = await groupTestNames([name]);
  assert.deepEqual(second.get(normalizeTestNameKey(name)), first.get(normalizeTestNameKey(name)));

  const { rows: afterSecond } = await pool.query(
    `SELECT * FROM custom_parameter_groups WHERE test_name_key = $1`,
    [normalizeTestNameKey(name)]
  );
  assert.equal(afterSecond.length, 1, 'a second call must not insert a duplicate row');
});
