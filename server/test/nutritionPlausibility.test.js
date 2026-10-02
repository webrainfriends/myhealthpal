const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPlausibility } = require('../src/diet/nutritionPlausibility');

const codes = (entry) => checkPlausibility(entry).issues.map((i) => i.code);

test('chutney logged at 0.2 and 1.5 kcal is flagged', () => {
  assert.deepEqual(codes({ name: 'Coconut chutney', quantity_amount: 2, quantity_unit: 'serving', calories: 0.2 }), ['CALORIES_TOO_LOW']);
  assert.ok(codes({ name: 'Mint chutney', quantity_amount: 2, quantity_unit: 'tbsp', calories: 1.5 }).includes('CALORIES_TOO_LOW'));
});

test('a realistic chutney portion is fine', () => {
  assert.deepEqual(codes({ name: 'Coconut chutney', quantity_amount: 2, quantity_unit: 'tbsp', calories: 60, protein_g: 1, carbs_g: 3, fat_g: 5.5 }), []);
});

test('zero-calorie drinks may be tiny', () => {
  assert.deepEqual(codes({ name: 'Black coffee', quantity_amount: 1, quantity_unit: 'cup', calories: 2 }), []);
  assert.deepEqual(codes({ name: 'Water', calories: 0 }), []);
});

test('kcal per gram: too many calories for the weight', () => {
  assert.ok(codes({ name: 'Rice', quantity_amount: 100, quantity_unit: 'g', calories: 2000 }).includes('CALORIES_PER_GRAM_HIGH'));
  assert.ok(!codes({ name: 'Rice', quantity_amount: 100, quantity_unit: 'g', calories: 130 }).includes('CALORIES_PER_GRAM_HIGH'));
});

test('kcal per gram: far too few calories for the weight', () => {
  assert.ok(codes({ name: 'Idli', quantity_amount: 300, quantity_unit: 'g', calories: 12 }).includes('CALORIES_PER_GRAM_LOW'));
});

test('serving weight is read both as per-serving and as the whole portion', () => {
  // 2 servings, serving_size_grams 150: 300 kcal is 1-2 kcal/g either way.
  assert.deepEqual(codes({ name: 'Dal', quantity_amount: 2, quantity_unit: 'serving', serving_size_grams: 150, calories: 300 }), []);
});

test('calories that disagree with the macros are flagged with a suggestion', () => {
  const result = checkPlausibility({ name: 'Paneer', calories: 50, protein_g: 18, carbs_g: 4, fat_g: 20 });
  assert.deepEqual(result.issues.map((i) => i.code), ['MACROS_MISMATCH']);
  assert.equal(result.suggestedCalories, 268);
  // Within tolerance (fiber/alcohol/rounding) is fine.
  assert.equal(checkPlausibility({ name: 'Oats', calories: 160, protein_g: 6, carbs_g: 28, fat_g: 3 }).ok, true);
});

test('impossible combinations are hard errors', () => {
  const r = checkPlausibility({ name: 'Papaya', calories: 60, carbs_g: 10, sugar_g: 25, fiber_g: 12, fat_g: 1, saturated_fat_g: 3, protein_g: 1 });
  assert.deepEqual(r.errors.map((i) => i.code).sort(), ['FIBER_GT_CARBS', 'SATFAT_GT_FAT', 'SUGAR_GT_CARBS']);
  assert.deepEqual(checkPlausibility({ name: 'x', calories: -5 }).errors.map((i) => i.code), ['NEGATIVE']);
});

test('missing values are never invented into issues', () => {
  assert.equal(checkPlausibility({ name: 'Mystery' }).ok, true);
  assert.equal(checkPlausibility({ name: 'Mystery', calories: null, protein_g: '', carbs_g: undefined }).ok, true);
});

const { mapPhotoItems } = require('../src/extraction/providers/dietPhotoProvider');
const { scanNote } = require('../src/diet/dietScanService');

test('photo items with implausible numbers are marked for review with a note', () => {
  const [item] = mapPhotoItems({
    items: [{ name: 'Coconut chutney', quantity_amount: 2, quantity_unit: 'serving', calories: 0.2, needs_quantity: false, confidence: 0.95 }],
  });
  assert.equal(item.needs_review, true);
  assert.deepEqual(item.issues.map((i) => i.code), ['CALORIES_TOO_LOW']);
  assert.match(scanNote(item), /^Check these numbers/);
});

test('a plausible photo item stays clean and carries no note', () => {
  const [item] = mapPhotoItems({
    items: [{ name: 'Papaya', preparation: 'fresh', quantity_amount: 150, quantity_unit: 'g', calories: 65, protein_g: 1, carbs_g: 16, fat_g: 0.3, sugar_g: 11, fiber_g: 2.5, needs_quantity: false, confidence: 0.9 }],
  });
  assert.equal(item.needs_review, false);
  assert.equal(item.issues.length, 0);
  assert.equal(scanNote(item), null);
});

test('a non-fresh assumed preparation is surfaced to the person', () => {
  const [item] = mapPhotoItems({
    items: [{ name: 'Papaya', preparation: 'canned in syrup', quantity_amount: 150, quantity_unit: 'g', calories: 120, carbs_g: 30, needs_quantity: false, confidence: 0.9 }],
  });
  assert.match(scanNote(item), /Assumed preparation: canned in syrup/);
});
