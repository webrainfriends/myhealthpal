const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWeight } = require('../src/services/healthProfileService');

test('summarizeWeight returns null for no entries', () => {
  assert.equal(summarizeWeight([], 170), null);
});

test('summarizeWeight computes change, range, average and BMI', () => {
  const s = summarizeWeight([{ weightKg: 80 }, { weightKg: 78 }, { weightKg: 76.5 }], 170);
  assert.equal(s.changeKg, -3.5);
  assert.equal(s.previousChangeKg, -1.5);
  assert.equal(s.lowestKg, 76.5);
  assert.equal(s.highestKg, 80);
  assert.equal(s.averageKg, 78.2);
  assert.equal(s.bmi.value, 26.5);
  assert.equal(s.bmi.category, 'overweight');
  assert.deepEqual(s.healthyRangeKg, { min: 53.5, max: 72 });
});

test('summarizeWeight has no BMI without height', () => {
  const s = summarizeWeight([{ weightKg: 70 }], null);
  assert.equal(s.bmi, null);
  assert.equal(s.previousChangeKg, null);
});
