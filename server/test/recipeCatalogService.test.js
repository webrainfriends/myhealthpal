const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const recipeCatalogService = require('../src/recipes/recipeCatalogService');
const { normalizeTitle, ingredientSignature } = recipeCatalogService;
const { saveScheduleRecipeSuggestion } = require('../src/diet/dietRecipeService');

test('normalizeTitle strips punctuation/stopwords/case so near-identical titles converge', () => {
  assert.equal(normalizeTitle('The Spicy Chicken Curry!'), 'spicy chicken curry');
  assert.equal(normalizeTitle('spicy chicken curry'), 'spicy chicken curry');
});

test('ingredientSignature normalizes prep words/case and dedupes so equivalent ingredient lists match', () => {
  const a = ingredientSignature([{ item: 'Chopped Onion' }, { item: 'Garlic cloves' }]);
  const b = ingredientSignature([{ item: 'onion, diced' }, { item: 'fresh garlic cloves' }]);
  assert.equal(a, b);
});

function sampleRecipe(title, ingredientNames) {
  return {
    title,
    mealType: 'lunch',
    description: 'test',
    servings: 2,
    prepTimeMinutes: 10,
    cookTimeMinutes: 10,
    ingredients: ingredientNames.map((item) => ({ item, amount: '1' })),
    instructions: ['Cook it.'],
    dietaryTags: [],
    whyThisRecipe: 'x',
    nutritionPerServing: {
      calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, saturated_fat_g: 1, fiber_g: 1, sugar_g: 1,
      sodium_mg: 1, cholesterol_mg: 1, potassium_mg: 1, calcium_mg: 1, iron_mg: 1, vitamin_d_mcg: 1,
    },
  };
}

let userId;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('catalog test') RETURNING id`);
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query(
    `DELETE FROM canonical_recipes WHERE normalized_title IN ('spicy chicken curry', 'dal tadka')`
  );
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('linkOrCreate creates one canonical entry, and a near-duplicate recipe links to the same entry', async () => {
  const first = await saveScheduleRecipeSuggestion(userId, sampleRecipe('Spicy Chicken Curry', ['chicken', 'onion', 'tomato']), 'lunch');
  const firstCanonicalId = await recipeCatalogService.linkOrCreate(first.id, first, { cuisine: 'south_indian', dietType: 'non_vegetarian' });
  assert.ok(firstCanonicalId);

  const second = await saveScheduleRecipeSuggestion(
    userId,
    sampleRecipe('spicy chicken curry!', ['chopped chicken', 'diced onion', 'fresh tomato']),
    'dinner'
  );
  const secondCanonicalId = await recipeCatalogService.linkOrCreate(second.id, second, { cuisine: 'south_indian', dietType: 'non_vegetarian' });

  assert.equal(secondCanonicalId, firstCanonicalId);

  const { rows } = await pool.query('SELECT count(*)::int AS c FROM canonical_recipes WHERE id = $1', [firstCanonicalId]);
  assert.equal(rows[0].c, 1);
});

test('a different cuisine for the same title/ingredients creates a separate canonical entry', async () => {
  const western = await saveScheduleRecipeSuggestion(userId, sampleRecipe('Dal Tadka', ['lentils', 'ghee']), 'lunch');
  const westernId = await recipeCatalogService.linkOrCreate(western.id, western, { cuisine: 'western', dietType: 'vegetarian' });

  const southIndian = await saveScheduleRecipeSuggestion(userId, sampleRecipe('Dal Tadka', ['lentils', 'ghee']), 'lunch');
  const southIndianId = await recipeCatalogService.linkOrCreate(southIndian.id, southIndian, { cuisine: 'south_indian', dietType: 'vegetarian' });

  assert.notEqual(westernId, southIndianId);
});

test('topPopularForContext ranks by love/like counts within the requested cuisine', async () => {
  const recipe = await saveScheduleRecipeSuggestion(userId, sampleRecipe('Popular Dish', ['rice']), 'lunch');
  const canonicalId = await recipeCatalogService.linkOrCreate(recipe.id, recipe, { cuisine: 'east_asian', dietType: 'vegan' });
  await pool.query('UPDATE canonical_recipes SET love_count = 5 WHERE id = $1', [canonicalId]);

  const popular = await recipeCatalogService.topPopularForContext({ cuisine: 'east_asian', dietType: 'vegan', limit: 3 });
  assert.ok(popular.some((p) => p.title === 'Popular Dish'));

  await pool.query('DELETE FROM canonical_recipes WHERE id = $1', [canonicalId]);
});
