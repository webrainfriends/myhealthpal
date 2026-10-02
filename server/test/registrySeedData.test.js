const test = require('node:test');
const assert = require('node:assert/strict');
const registryData = require('../db/registry-seed-data');

// The Health Parameter Registry is matched by exact code/display-name/alias
// text (see extraction/registry.js findCanonicalMatches) - if two distinct
// parameters ever registered the same string, every report mentioning it
// would be flagged "ambiguous" (or worse, silently resolve to whichever
// query returned first) instead of mapping cleanly. This guards the seed
// data itself so that never regresses silently.
test('every registry code is unique', () => {
  const codes = registryData.map((p) => p.code);
  const duplicates = codes.filter((code, i) => codes.indexOf(code) !== i);
  assert.deepEqual(duplicates, []);
});

test('no alias/code/display-name string is claimed by more than one parameter', () => {
  const owners = new Map(); // normalized string -> [codes that claim it]
  for (const param of registryData) {
    const strings = new Set([param.code, param.displayName, ...param.aliases].map((s) => s.trim().toLowerCase()));
    for (const s of strings) {
      const owningCodes = owners.get(s) || [];
      owningCodes.push(param.code);
      owners.set(s, owningCodes);
    }
  }
  const collisions = [...owners.entries()].filter(([, codes]) => new Set(codes).size > 1);
  assert.deepEqual(collisions, [], `Collisions found (string -> owning codes): ${JSON.stringify(collisions)}`);
});

test('Urea and BUN are kept as distinct parameters (not numerically interchangeable)', () => {
  const urea = registryData.find((p) => p.code === 'urea');
  const bun = registryData.find((p) => p.code === 'bun');
  assert.ok(urea && bun, 'both urea and bun should be registered');
  assert.ok(!urea.aliases.some((a) => /bun|urea nitrogen/i.test(a)), 'urea must not also claim BUN-labeled results');
  assert.ok(!bun.aliases.includes('urea'), 'bun must not claim a bare "urea" result');
});

test('every conversion factor is a finite, non-zero number', () => {
  for (const param of registryData) {
    for (const conversion of param.conversions) {
      assert.ok(Number.isFinite(conversion.factor) && conversion.factor !== 0, `${param.code}: bad factor for ${conversion.fromUnit}`);
      assert.ok(Number.isFinite(conversion.offset), `${param.code}: bad offset for ${conversion.fromUnit}`);
    }
  }
});

test('a parameter never declares a conversion from its own canonical unit', () => {
  for (const param of registryData) {
    for (const conversion of param.conversions) {
      assert.notEqual(
        conversion.fromUnit.replace(/\s+/g, '').toLowerCase(),
        String(param.canonicalUnit).replace(/\s+/g, '').toLowerCase(),
        `${param.code}: redundant self-conversion`
      );
    }
  }
});

test('no two parameters share a name once spacing and punctuation are ignored', () => {
  // Matching squashes names to letters+digits, so "Cholesterol/HDL" and
  // "Cholesterol - HDL" are the same key: they must not belong to different
  // parameters or every such name becomes ambiguous.
  const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const owner = new Map();
  const clashes = [];
  for (const p of registryData) {
    for (const name of [p.code, p.displayName, ...p.aliases]) {
      const key = squash(name);
      if (!key) continue;
      if (owner.has(key) && owner.get(key) !== p.code) clashes.push(`${name} (${p.code}) vs ${owner.get(key)}`);
      else owner.set(key, p.code);
    }
  }
  assert.deepEqual(clashes, []);
});
