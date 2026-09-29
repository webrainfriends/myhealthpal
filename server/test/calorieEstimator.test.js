const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateCalories } = require('../src/workout/calorieEstimator');

test('uses weight and duration for a moderate-confidence range', () => {
  const r = estimateCalories({ metValue: 5, weightKg: 80, activeSeconds: 1800 });
  assert.equal(r.confidence, 'moderate');
  assert.ok(r.low < 160 && r.high > 160); // (5-1)*80*0.5 = 160
  assert.ok(r.inputs.sources.includes('body weight'));
});

test('falls back to a default weight with low confidence and a wider range', () => {
  const r = estimateCalories({ metValue: 5, weightKg: null, activeSeconds: 1800 });
  assert.equal(r.confidence, 'low');
  assert.equal(r.inputs.weightIsDefault, true);
});

test('zero duration yields zero', () => {
  assert.deepEqual([estimateCalories({ metValue: 5, activeSeconds: 0 }).low, estimateCalories({ metValue: 5, activeSeconds: 0 }).high], [0, 0]);
});
