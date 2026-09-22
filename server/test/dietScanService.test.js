const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMealType } = require('../src/diet/dietScanService');

function at(hour, minute = 0) {
  return new Date(2026, 5, 15, hour, minute, 0);
}

test('classifyMealType tags the morning band as breakfast', () => {
  assert.equal(classifyMealType(at(4, 0)), 'breakfast');
  assert.equal(classifyMealType(at(7, 30)), 'breakfast');
  assert.equal(classifyMealType(at(10, 59)), 'breakfast');
});

test('classifyMealType tags midday as lunch', () => {
  assert.equal(classifyMealType(at(11, 0)), 'lunch');
  assert.equal(classifyMealType(at(13, 0)), 'lunch');
  assert.equal(classifyMealType(at(15, 59)), 'lunch');
});

test('classifyMealType tags afternoon as a snack', () => {
  assert.equal(classifyMealType(at(16, 0)), 'snack');
  assert.equal(classifyMealType(at(17, 59)), 'snack');
});

test('classifyMealType tags evening as dinner', () => {
  assert.equal(classifyMealType(at(18, 0)), 'dinner');
  assert.equal(classifyMealType(at(21, 29)), 'dinner');
});

test('classifyMealType tags late evening as supper', () => {
  assert.equal(classifyMealType(at(21, 30)), 'supper');
  assert.equal(classifyMealType(at(23, 59)), 'supper');
});

test('classifyMealType tags the small hours as a (late-night) snack', () => {
  assert.equal(classifyMealType(at(0, 0)), 'snack');
  assert.equal(classifyMealType(at(3, 59)), 'snack');
});

test('classifyMealType accepts a date-like string', () => {
  assert.equal(classifyMealType('2026-06-15T12:00:00'), 'lunch');
});
