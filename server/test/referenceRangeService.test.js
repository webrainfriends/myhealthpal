const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreAgainstRange } = require('../src/medications/referenceRangeService');

const RANGE = { range_low: 70, range_high: 99 };

test('scoreAgainstRange is "unknown" without a value or a range', () => {
  assert.equal(scoreAgainstRange(null, RANGE).status, 'unknown');
  assert.equal(scoreAgainstRange(85, null).status, 'unknown');
});

test('scoreAgainstRange classifies below/within/above a standards range', () => {
  assert.deepEqual(scoreAgainstRange(60, RANGE), { status: 'below_range', inRange: false });
  assert.deepEqual(scoreAgainstRange(85, RANGE), { status: 'in_range', inRange: true });
  assert.deepEqual(scoreAgainstRange(120, RANGE), { status: 'above_range', inRange: false });
});

test('scoreAgainstRange treats the range edges as in-range', () => {
  assert.equal(scoreAgainstRange(70, RANGE).status, 'in_range');
  assert.equal(scoreAgainstRange(99, RANGE).status, 'in_range');
});
