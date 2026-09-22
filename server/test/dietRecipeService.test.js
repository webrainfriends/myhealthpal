const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRecipeResult, buildUserMessage } = require('../src/diet/dietRecipeService');

test('buildUserMessage includes meal type, preferences, and considerations when given', () => {
  const message = buildUserMessage({
    mealType: 'lunch',
    preferences: 'vegetarian, use spinach',
    considerations: [{ key: 'diabetes', label: 'blood sugar management' }],
  });
  assert.match(message, /Meal type: lunch/);
  assert.match(message, /vegetarian, use spinach/);
  assert.match(message, /blood sugar management/);
});

test('buildUserMessage states plainly when nothing was given', () => {
  const message = buildUserMessage({ mealType: null, preferences: null, considerations: [] });
  assert.match(message, /not specified/);
  assert.match(message, /No specific preferences/);
  assert.match(message, /No dietary considerations/);
});

test('mapRecipeResult normalizes ingredients/instructions and appends the safety tail', () => {
  const recipe = mapRecipeResult({
    title: 'Spinach Dal',
    description: 'A lentil curry',
    servings: 4,
    ingredients: [{ item: 'Spinach', amount: '2 cups' }, { item: '' }],
    instructions: ['Cook lentils', 'Add spinach', 42],
    dietary_tags: ['vegetarian', 'high-fiber'],
    why_this_recipe: 'Fiber-forward and lower in sodium.',
    calories: 220,
    iron_mg: 3,
  });

  assert.equal(recipe.title, 'Spinach Dal');
  assert.equal(recipe.ingredients.length, 1); // the item-less entry is dropped
  assert.equal(recipe.instructions.length, 2); // the non-string entry is dropped
  assert.deepEqual(recipe.dietaryTags, ['vegetarian', 'high-fiber']);
  assert.match(recipe.whyThisRecipe, /Fiber-forward and lower in sodium\./);
  assert.match(recipe.whyThisRecipe, /not medical or dietary advice/);
  assert.equal(recipe.nutritionPerServing.calories, 220);
  assert.equal(recipe.nutritionPerServing.iron_mg, 3);
  // Never a fabricated 0 for a nutrient the model didn't report.
  assert.equal(recipe.nutritionPerServing.sodium_mg, null);
});

test('mapRecipeResult returns null for a missing/malformed tool input', () => {
  assert.equal(mapRecipeResult(null), null);
  assert.equal(mapRecipeResult(undefined), null);
  assert.equal(mapRecipeResult('not an object'), null);
});

test('mapRecipeResult falls back to a placeholder title rather than an empty one', () => {
  const recipe = mapRecipeResult({ servings: 2, ingredients: [], instructions: [], why_this_recipe: 'x' });
  assert.equal(recipe.title, 'Untitled recipe');
});
