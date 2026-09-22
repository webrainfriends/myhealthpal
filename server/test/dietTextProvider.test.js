const test = require('node:test');
const assert = require('node:assert/strict');
const { mapEstimateResult, buildUserMessage } = require('../src/extraction/providers/dietTextProvider');

test('buildUserMessage asks for a typical serving when no quantity is given', () => {
  const message = buildUserMessage('chicken biryani', null, null);
  assert.match(message, /chicken biryani/);
  assert.match(message, /typical serving/);
});

test('buildUserMessage asks for the exact quantity when one is given', () => {
  const message = buildUserMessage('rice', 2, 'cup');
  assert.match(message, /2 cup/);
  assert.doesNotMatch(message, /typical serving/);
});

test('mapEstimateResult recognizes a dish and fills every numeric nutrient given', () => {
  const result = mapEstimateResult({
    recognized: true,
    matched_food_description: 'Chicken biryani, a mixed rice dish with chicken and spices',
    quantity_amount: 1.5,
    quantity_unit: 'cup',
    serving_size_grams: 300,
    calories: 450,
    protein_g: 22,
    iron_mg: 2.1,
    confidence: 0.85,
  });

  assert.equal(result.recognized, true);
  assert.equal(result.matchedFoodDescription, 'Chicken biryani, a mixed rice dish with chicken and spices');
  assert.equal(result.quantityAmount, 1.5);
  assert.equal(result.quantityUnit, 'cup');
  assert.equal(result.servingSizeGrams, 300);
  assert.equal(result.nutrients.calories, 450);
  assert.equal(result.nutrients.protein_g, 22);
  assert.equal(result.nutrients.iron_mg, 2.1);
  // Fields not present in the model's output are left null, not zero -
  // never silently defaulted to a fabricated 0.
  assert.equal(result.nutrients.carbs_g, null);
  assert.equal(result.confidence, 0.85);
});

test('mapEstimateResult ignores non-number nutrient values rather than trusting them', () => {
  const result = mapEstimateResult({ recognized: true, confidence: 0.6, calories: 'a lot', protein_g: 20 });
  assert.equal(result.nutrients.calories, null);
  assert.equal(result.nutrients.protein_g, 20);
});

test('mapEstimateResult returns nothing (all null) when the food was not recognized', () => {
  const result = mapEstimateResult({ recognized: false, confidence: 0.1, calories: 999, matched_food_description: 'should be ignored' });
  assert.equal(result.recognized, false);
  assert.equal(result.matchedFoodDescription, null);
  assert.equal(result.quantityAmount, null);
  // Even a stray calories value on an unrecognized result must never leak
  // through - the hallucination guard here is "recognized=false blocks
  // everything", not per-field filtering.
  assert.equal(result.nutrients.calories, null);
});

test('mapEstimateResult handles a missing/malformed tool input gracefully', () => {
  assert.equal(mapEstimateResult(null).recognized, false);
  assert.equal(mapEstimateResult(undefined).recognized, false);
  assert.equal(mapEstimateResult('not an object').recognized, false);
});
