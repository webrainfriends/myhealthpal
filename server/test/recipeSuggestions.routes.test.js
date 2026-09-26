const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');
const { saveRecipeSuggestions } = require('../src/diet/dietRecipeService');

// GET /recipes/feed and POST /recipes/:id/log never call the AI - they
// only read/write already-saved recipe_suggestions rows - so these are
// tested as plain HTTP routes against seeded rows, with no ANTHROPIC_API_KEY
// needed. POST /recipes/feed (generation) is exercised at the service
// level in dietRecipeService.test.js, where the Anthropic stream is
// replayed directly.

function sampleRecipe(title, mealType) {
  return {
    title,
    mealType,
    description: 'A test dish.',
    servings: 2,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ingredients: [{ item: 'rice', amount: '1 cup' }],
    instructions: ['Cook it.'],
    dietaryTags: [],
    whyThisRecipe: 'Fits your goals.',
    nutritionPerServing: {
      calories: 400, protein_g: 12, carbs_g: 60, fat_g: 8, saturated_fat_g: 2, fiber_g: 5, sugar_g: 3,
      sodium_mg: 300, cholesterol_mg: 0, potassium_mg: 200, calcium_mg: 50, iron_mg: 2, vitamin_d_mcg: 0,
    },
  };
}

let userId;
let token;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('recipe routes test') RETURNING id`);
  userId = user.rows[0].id;
  token = signSession({ id: userId });
});

test.after(async () => {
  await pool.query('DELETE FROM food_entries WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /api/diet/recipes/feed lists this user\'s saved suggestions, newest first, and never another user\'s', async () => {
  const [dal] = await saveRecipeSuggestions(userId, [sampleRecipe('Dal', 'lunch')], null);
  await saveRecipeSuggestions(userId, [sampleRecipe('Oats', 'breakfast')], null);

  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other recipe routes user') RETURNING id`);
  await saveRecipeSuggestions(other.rows[0].id, [sampleRecipe('Not Yours', 'lunch')], null);

  const { server, base } = await listen();
  try {
    const res = await fetch(`${base}/api/diet/recipes/feed`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.recipes.map((r) => r.title), ['Oats', 'Dal']);
    assert.ok(!body.recipes.some((r) => r.title === 'Not Yours'));

    const filtered = await fetch(`${base}/api/diet/recipes/feed?meal_type=lunch`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const filteredBody = await filtered.json();
    assert.deepEqual(filteredBody.recipes.map((r) => r.id), [dal.id]);

    const badFilter = await fetch(`${base}/api/diet/recipes/feed?meal_type=nonsense`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(badFilter.status, 400);

    const unauthenticated = await fetch(`${base}/api/diet/recipes/feed`);
    assert.equal(unauthenticated.status, 401);
  } finally {
    server.close();
    await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});

test('POST /api/diet/recipes/:id/log creates a food entry and marks the suggestion added, scoped to the caller', async () => {
  const [poha] = await saveRecipeSuggestions(userId, [sampleRecipe('Poha', 'breakfast')], null);
  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other recipe routes user 2') RETURNING id`);
  const [theirs] = await saveRecipeSuggestions(other.rows[0].id, [sampleRecipe('Theirs', 'lunch')], null);

  const { server, base } = await listen();
  try {
    const res = await fetch(`${base}/api/diet/recipes/${poha.id}/log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.entry.name, 'Poha');
    assert.equal(body.entry.recipe_suggestion_id, poha.id);

    const crossUser = await fetch(`${base}/api/diet/recipes/${theirs.id}/log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(crossUser.status, 404);

    const missing = await fetch(`${base}/api/diet/recipes/00000000-0000-0000-0000-000000000000/log`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 404);
  } finally {
    server.close();
    await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});
