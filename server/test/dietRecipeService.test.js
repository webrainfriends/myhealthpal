const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRecipeResult, buildUserMessage, buildFeedUserMessage, describeActivity } = require('../src/diet/dietRecipeService');

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

test('mapRecipeResult reads meal_type from a batch result, null when absent/invalid', () => {
  const withMealType = mapRecipeResult({ title: 'x', meal_type: 'breakfast', servings: 1, ingredients: [], instructions: [], why_this_recipe: 'x' });
  assert.equal(withMealType.mealType, 'breakfast');

  const withoutMealType = mapRecipeResult({ title: 'x', servings: 1, ingredients: [], instructions: [], why_this_recipe: 'x' });
  assert.equal(withoutMealType.mealType, null);

  const invalidMealType = mapRecipeResult({ title: 'x', meal_type: 'elevenses', servings: 1, ingredients: [], instructions: [], why_this_recipe: 'x' });
  assert.equal(invalidMealType.mealType, null);
});

test('describeActivity returns null when nothing was logged', () => {
  assert.equal(describeActivity([]), null);
  assert.equal(describeActivity([{ steps: null, exercise_minutes: null }]), null);
});

test('describeActivity averages logged days and classifies the level against the step goal', () => {
  const active = describeActivity([{ steps: 12000, exercise_minutes: 40 }, { steps: 11000, exercise_minutes: 20 }]);
  assert.equal(active.avgSteps, 11500);
  assert.equal(active.avgExerciseMinutes, 30);
  assert.equal(active.level, 'active');

  const low = describeActivity([{ steps: 1000, exercise_minutes: 0 }]);
  assert.equal(low.level, 'low activity');

  const moderate = describeActivity([{ steps: 6000, exercise_minutes: 10 }]);
  assert.equal(moderate.level, 'moderately active');
});

test('buildFeedUserMessage asks for the requested count and states every signal given', () => {
  const message = buildFeedUserMessage({
    mealType: 'lunch',
    count: 10,
    considerations: [{ key: 'diabetes', label: 'blood sugar management' }],
    activity: { avgSteps: 4000, avgExerciseMinutes: 15, level: 'low activity' },
    weightGoal: { currentWeightKg: 82, targetWeightKg: 75, targetDate: '2026-12-01' },
    preferences: { dietTypes: ['vegetarian'], cuisines: ['south_indian'] },
    excludeTitles: ['Spinach Dal'],
  });
  assert.match(message, /Generate 10 recipes/);
  assert.match(message, /all should be lunch/);
  assert.match(message, /blood sugar management/);
  assert.match(message, /low activity/);
  assert.match(message, /lose weight, from 82kg toward a target of 75kg by 2026-12-01/);
  assert.match(message, /vegetarian/);
  assert.match(message, /south indian/);
  assert.match(message, /Do not repeat.*Spinach Dal/);
});

test('buildFeedUserMessage states plainly when a signal is absent', () => {
  const message = buildFeedUserMessage({
    mealType: null,
    count: 10,
    considerations: [],
    activity: null,
    weightGoal: null,
    preferences: { dietTypes: [], cuisines: [] },
    excludeTitles: [],
  });
  assert.match(message, /vary across breakfast/);
  assert.match(message, /No dietary considerations/);
  assert.match(message, /No recent activity data/);
  assert.match(message, /No weight goal is on file/);
  assert.doesNotMatch(message, /Do not repeat/);
});
