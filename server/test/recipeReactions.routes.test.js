const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { signSession } = require('../src/services/authService');
const { saveRecipeSuggestions } = require('../src/diet/dietRecipeService');

function sampleRecipe(title) {
  return {
    title, mealType: 'lunch', description: 'test', servings: 2, prepTimeMinutes: 10, cookTimeMinutes: 10,
    ingredients: [{ item: 'rice', amount: '1 cup' }], instructions: ['Cook it.'], dietaryTags: [], whyThisRecipe: 'x',
    nutritionPerServing: {
      calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, saturated_fat_g: 1, fiber_g: 1, sugar_g: 1,
      sodium_mg: 1, cholesterol_mg: 1, potassium_mg: 1, calcium_mg: 1, iron_mg: 1, vitamin_d_mcg: 1,
    },
  };
}

let userId;
let token;

test.before(async () => {
  const user = await pool.query(`INSERT INTO users (display_name) VALUES ('reaction routes test') RETURNING id`);
  userId = user.rows[0].id;
  token = signSession({ id: userId });
});

test.after(async () => {
  await pool.query('DELETE FROM recipe_reactions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

async function listen() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('PUT sets a single reaction, switching type upserts rather than duplicating, DELETE clears it', async () => {
  const [saved] = await saveRecipeSuggestions(userId, [sampleRecipe('Reaction Test Dish')], null);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const { server, base } = await listen();
  try {
    const badType = await fetch(`${base}/api/recipe-reactions/${saved.id}`, { method: 'PUT', headers, body: JSON.stringify({ reactionType: 'nonsense' }) });
    assert.equal(badType.status, 400);

    const loved = await fetch(`${base}/api/recipe-reactions/${saved.id}`, { method: 'PUT', headers, body: JSON.stringify({ reactionType: 'love' }) });
    assert.equal(loved.status, 200);
    assert.equal((await loved.json()).reaction.reactionType, 'love');

    const switched = await fetch(`${base}/api/recipe-reactions/${saved.id}`, { method: 'PUT', headers, body: JSON.stringify({ reactionType: 'unlike' }) });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).reaction.reactionType, 'unlike');

    const { rows } = await pool.query('SELECT count(*)::int AS c FROM recipe_reactions WHERE user_id = $1 AND recipe_suggestion_id = $2', [userId, saved.id]);
    assert.equal(rows[0].c, 1);

    const cleared = await fetch(`${base}/api/recipe-reactions/${saved.id}`, { method: 'DELETE', headers });
    assert.equal(cleared.status, 204);

    const clearAgain = await fetch(`${base}/api/recipe-reactions/${saved.id}`, { method: 'DELETE', headers });
    assert.equal(clearAgain.status, 404);
  } finally {
    server.close();
  }
});

test('GET batches reaction state for a list of recipe suggestion ids, scoped to the caller', async () => {
  const [loved, unreacted] = await saveRecipeSuggestions(userId, [sampleRecipe('Loved Dish'), sampleRecipe('Unreacted Dish')], null);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server, base } = await listen();
  try {
    await fetch(`${base}/api/recipe-reactions/${loved.id}`, { method: 'PUT', headers, body: JSON.stringify({ reactionType: 'love' }) });

    const res = await fetch(`${base}/api/recipe-reactions?ids=${loved.id},${unreacted.id}`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reactions[loved.id], 'love');
    assert.equal(body.reactions[unreacted.id], undefined);
  } finally {
    server.close();
  }
});

test('a reaction cannot be set on another user\'s recipe suggestion', async () => {
  const other = await pool.query(`INSERT INTO users (display_name) VALUES ('other reaction user') RETURNING id`);
  const [theirs] = await saveRecipeSuggestions(other.rows[0].id, [sampleRecipe('Not Yours')], null);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const { server, base } = await listen();
  try {
    const res = await fetch(`${base}/api/recipe-reactions/${theirs.id}`, { method: 'PUT', headers, body: JSON.stringify({ reactionType: 'love' }) });
    assert.equal(res.status, 404);
  } finally {
    server.close();
    await pool.query('DELETE FROM recipe_suggestions WHERE user_id = $1', [other.rows[0].id]);
    await pool.query('DELETE FROM users WHERE id = $1', [other.rows[0].id]);
  }
});
