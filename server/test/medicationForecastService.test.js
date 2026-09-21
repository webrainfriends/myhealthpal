const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDose, forecastStage } = require('../src/medications/medicationForecastService');

test('classifyDose returns null without a knowledge base dose band', () => {
  const med = { dosage_amount: 500, dosage_unit: 'mg', frequency_per_day: 2 };
  assert.equal(classifyDose(med, null), null);
  assert.equal(classifyDose(med, { typicalDailyDose: null }), null);
});

test('classifyDose returns null on a unit mismatch rather than guessing', () => {
  const med = { dosage_amount: 500, dosage_unit: 'mcg', frequency_per_day: 2 };
  const entry = { typicalDailyDose: { amountMin: 500, amountMax: 2550, unit: 'mg' } };
  assert.equal(classifyDose(med, entry), null);
});

test('classifyDose multiplies amount x frequency and classifies against the typical band', () => {
  const entry = { typicalDailyDose: { amountMin: 500, amountMax: 2550, unit: 'mg' } };

  const within = classifyDose({ dosage_amount: 500, dosage_unit: 'mg', frequency_per_day: 2 }, entry);
  assert.equal(within.level, 'within_typical');
  assert.equal(within.dailyDose, 1000);

  const below = classifyDose({ dosage_amount: 250, dosage_unit: 'mg', frequency_per_day: 1 }, entry);
  assert.equal(below.level, 'below_typical');

  const above = classifyDose({ dosage_amount: 1500, dosage_unit: 'mg', frequency_per_day: 2 }, entry);
  assert.equal(above.level, 'above_typical');
});

test('forecastStage is "unknown" without an onset window', () => {
  assert.equal(forecastStage(30, null, null), 'unknown');
  assert.equal(forecastStage(null, 4, 8), 'unknown');
});

test('forecastStage moves too_early -> improvement_expected_now -> reassess_with_labs', () => {
  // Onset window: 4-8 weeks (28-56 days).
  assert.equal(forecastStage(14, 4, 8), 'too_early');
  assert.equal(forecastStage(35, 4, 8), 'improvement_expected_now');
  assert.equal(forecastStage(70, 4, 8), 'reassess_with_labs');
});

test('forecastStage treats an open-ended onset window as always "expected now" once reached', () => {
  assert.equal(forecastStage(60, 4, null), 'improvement_expected_now');
});
