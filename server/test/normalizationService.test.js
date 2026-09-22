const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCandidate } = require('../src/extraction/normalizationService');

// Regression test for a real production failure: a report whose candidates
// matched a canonical parameter but carried no unit at all (candidate.unit
// null/undefined/'') caused needs_review to come back as that same falsy,
// non-boolean value instead of `false` - a JS `a || b || c` chain returns
// whichever operand it stops on, not necessarily a boolean - which then hit
// health_measurements.needs_review's NOT NULL constraint at insert time and
// failed the whole report ("null value in column "needs_review" ... violates
// not-null constraint").
test('needs_review is always a boolean, even when a matched parameter has no unit on the candidate', async () => {
  for (const unit of [null, undefined, '']) {
    // 'Albumin' is seeded (db/registry-seed-data.js) as a numeric parameter
    // with canonical_unit 'g/dL' and no unit conversions - exactly the shape
    // that hit the bug: matched, numeric, but candidate.unit is falsy.
    const measurement = await normalizeCandidate({
      test_name: 'Albumin',
      value: '4.02',
      unit,
      reference_range: '3.5-5.0',
      status_flag: null,
      param_date: null,
      confidence: 0.9,
      needs_review: false,
      raw_source_text: 'Albumin 4.02',
    });

    assert.equal(typeof measurement.needs_review, 'boolean');
    assert.equal(measurement.needs_review, false);
  }
});

test('needs_review is always a boolean when the candidate is unmapped', async () => {
  const measurement = await normalizeCandidate({
    test_name: 'Some Totally Unrecognized Test Name XYZ',
    value: '1.4',
    unit: null,
    reference_range: null,
    status_flag: null,
    param_date: null,
    confidence: 0.9,
    needs_review: false,
    raw_source_text: 'Some Totally Unrecognized Test Name XYZ 1.4',
  });

  assert.equal(typeof measurement.needs_review, 'boolean');
  assert.equal(measurement.needs_review, true);
});
