const test = require('node:test');
const assert = require('node:assert/strict');
const { numbersDiffer, nutritionValuesChanged, computeAiVerified } = require('../src/diet/aiVerificationService');

test('numbersDiffer treats matching values (including string vs number) as unchanged', () => {
  assert.equal(numbersDiffer('320.00', 320), false);
  assert.equal(numbersDiffer(null, null), false);
  assert.equal(numbersDiffer(undefined, null), false);
});

test('numbersDiffer flags a real change, including null vs a value', () => {
  assert.equal(numbersDiffer('320', 321), true);
  assert.equal(numbersDiffer(null, 5), true);
  assert.equal(numbersDiffer(5, null), true);
});

test('nutritionValuesChanged is false when a field is resent with the same value', () => {
  const existing = { calories: '320.00', protein_g: '10.00', quantity_amount: '1.00', quantity_unit: 'serving' };
  const body = { calories: 320, protein_g: 10, quantity_amount: 1, quantity_unit: 'serving', notes: 'unrelated edit' };
  const next = { ...existing, ...body };
  assert.equal(nutritionValuesChanged(body, next, existing), false);
});

test('nutritionValuesChanged is true when a nutrient field actually changes', () => {
  const existing = { calories: '320.00' };
  const body = { calories: 400 };
  const next = { ...existing, ...body };
  assert.equal(nutritionValuesChanged(body, next, existing), true);
});

test('nutritionValuesChanged is true for a quantity_unit change even with matching numbers', () => {
  const existing = { quantity_amount: '1.00', quantity_unit: 'serving' };
  const body = { quantity_amount: 1, quantity_unit: 'cup' };
  const next = { ...existing, ...body };
  assert.equal(nutritionValuesChanged(body, next, existing), true);
});

test('nutritionValuesChanged ignores fields the request never touched', () => {
  const existing = { calories: '320.00', name: 'Old name' };
  const body = { name: 'New name' };
  const next = { ...existing, ...body };
  assert.equal(nutritionValuesChanged(body, next, existing), false);
});

test('computeAiVerified: an explicit client value always wins', () => {
  assert.equal(computeAiVerified({ explicitValue: true, nutritionChanged: true, fallback: false }), true);
  assert.equal(computeAiVerified({ explicitValue: false, nutritionChanged: false, fallback: true }), false);
});

test('computeAiVerified: a real nutrition change resets it when nothing explicit was sent', () => {
  assert.equal(computeAiVerified({ explicitValue: undefined, nutritionChanged: true, fallback: true }), false);
});

test('computeAiVerified: leaves the existing value alone when nothing relevant changed', () => {
  assert.equal(computeAiVerified({ explicitValue: undefined, nutritionChanged: false, fallback: true }), true);
  assert.equal(computeAiVerified({ explicitValue: undefined, nutritionChanged: false, fallback: false }), false);
});
