const pool = require('../db/pool');

// The shared/canonical recipe catalog (026_recipe_catalog.sql): recipe_suggestions
// (019) is per-user, with nowhere to aggregate "how many people loved this"
// across accounts. This service computes a deterministic dedup key for a
// generated recipe and links its recipe_suggestions row to one shared
// canonical_recipes row, so reactions/schedule-adds/logs from every user who
// was ever given a similar-enough recipe roll up onto the same place.
//
// Matching is a plain string-normalization key (title + cuisine +
// core-ingredient signature) - never a fuzzy/AI similarity judgment, the
// same "deterministic lookup, never an LLM guess" principle
// dietInsightService.js's CATEGORY_CONSIDERATIONS comment states for its own
// matching.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'with', 'and', 'of', 'in', 'style', 'recipe', 'fresh', 'homemade',
]);

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word))
    .join(' ')
    .trim();
}

// A short, sorted signature of the recipe's core ingredients - normalizes
// each ingredient name (lowercased, punctuation stripped, common prep words
// dropped so "chopped onion" and "onion, diced" both key to "onion"), then
// keeps only the first 8 distinct names alphabetically so a long tail of
// minor ingredients (salt, water, garnish) doesn't fragment the key.
const PREP_WORDS = new Set([
  'chopped', 'diced', 'sliced', 'minced', 'grated', 'crushed', 'ground', 'fresh', 'dried',
  'large', 'small', 'medium', 'whole', 'peeled', 'cooked', 'raw', 'to', 'taste',
]);

function normalizeIngredientName(item) {
  return String(item || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !PREP_WORDS.has(word))
    .join(' ')
    .trim();
}

function ingredientSignature(ingredients) {
  const names = new Set();
  for (const ing of Array.isArray(ingredients) ? ingredients : []) {
    const name = normalizeIngredientName(ing && ing.item);
    if (name) names.add(name);
  }
  return [...names].sort().slice(0, 8).join('|');
}

const CATALOG_NUTRIENT_FIELDS = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'sugar_g',
  'sodium_mg', 'cholesterol_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'vitamin_d_mcg',
];

// Links a just-saved recipe_suggestions row to its canonical catalog entry,
// creating one if this exact (title, cuisine, ingredient-signature) key
// hasn't been seen before. Safe to call for every recipe a person is given
// (feed, single generation, kitchen generation, backfill) - cuisine/dietType
// are whatever context the caller has (the person's saved preference, or
// null when generation had none to go on).
async function linkOrCreate(recipeSuggestionId, recipe, { cuisine = null, dietType = null } = {}) {
  const normalizedTitle = normalizeTitle(recipe.title);
  const signature = ingredientSignature(recipe.ingredients);
  if (!normalizedTitle || !signature) return null;

  const nutrition = recipe.nutritionPerServing || {};
  const { rows: inserted } = await pool.query(
    `INSERT INTO canonical_recipes (
       normalized_title, cuisine, diet_type, ingredient_signature, title, description, meal_type,
       servings, prep_time_minutes, cook_time_minutes, ingredients, instructions, dietary_tags,
       ${CATALOG_NUTRIENT_FIELDS.join(', ')}
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       ${CATALOG_NUTRIENT_FIELDS.map((_, i) => `$${i + 14}`).join(', ')}
     )
     ON CONFLICT (normalized_title, cuisine, ingredient_signature) DO NOTHING
     RETURNING id`,
    [
      normalizedTitle, cuisine, dietType, signature, recipe.title, recipe.description || null,
      recipe.mealType || null, recipe.servings ?? null, recipe.prepTimeMinutes ?? null, recipe.cookTimeMinutes ?? null,
      JSON.stringify(recipe.ingredients || []), JSON.stringify(recipe.instructions || []), JSON.stringify(recipe.dietaryTags || []),
      ...CATALOG_NUTRIENT_FIELDS.map((f) => nutrition[f] ?? null),
    ]
  );

  let canonicalId = inserted[0]?.id;
  if (!canonicalId) {
    const { rows: existing } = await pool.query(
      `SELECT id FROM canonical_recipes WHERE normalized_title = $1 AND cuisine IS NOT DISTINCT FROM $2 AND ingredient_signature = $3`,
      [normalizedTitle, cuisine, signature]
    );
    canonicalId = existing[0]?.id;
  }
  if (!canonicalId) return null;

  await pool.query('UPDATE recipe_suggestions SET canonical_recipe_id = $1 WHERE id = $2', [canonicalId, recipeSuggestionId]);
  return canonicalId;
}

// Advisory candidates for a generation prompt - "recipes other users with
// similar preferences have loved" context, never a forced/tool-constrained
// selection (see scheduleGenerationService.js's prompt design).
async function topPopularForContext({ cuisine, dietType, limit = 5 } = {}) {
  const conditions = [];
  const params = [];
  if (cuisine) {
    params.push(cuisine);
    conditions.push(`cuisine = $${params.length}`);
  }
  if (dietType) {
    params.push(dietType);
    conditions.push(`(diet_type = $${params.length} OR diet_type IS NULL)`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(Number(limit) || 5, 1), 20));

  const { rows } = await pool.query(
    `SELECT title, description, dietary_tags, love_count, like_count
     FROM canonical_recipes ${where}
     ORDER BY love_count DESC, like_count DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function recomputeCounts(canonicalRecipeId) {
  await pool.query(
    `UPDATE canonical_recipes SET
       love_count = (
         SELECT count(*) FROM recipe_reactions r JOIN recipe_suggestions s ON s.id = r.recipe_suggestion_id
         WHERE s.canonical_recipe_id = $1 AND r.reaction_type = 'love'
       ),
       like_count = (
         SELECT count(*) FROM recipe_reactions r JOIN recipe_suggestions s ON s.id = r.recipe_suggestion_id
         WHERE s.canonical_recipe_id = $1 AND r.reaction_type = 'like'
       ),
       unlike_count = (
         SELECT count(*) FROM recipe_reactions r JOIN recipe_suggestions s ON s.id = r.recipe_suggestion_id
         WHERE s.canonical_recipe_id = $1 AND r.reaction_type = 'unlike'
       ),
       updated_at = now()
     WHERE id = $1`,
    [canonicalRecipeId]
  );
}

async function recordReactionRollup(canonicalRecipeId) {
  if (!canonicalRecipeId) return;
  await recomputeCounts(canonicalRecipeId);
}

async function recordScheduleAdd(canonicalRecipeId) {
  if (!canonicalRecipeId) return;
  await pool.query(
    'UPDATE canonical_recipes SET added_to_schedule_count = added_to_schedule_count + 1, updated_at = now() WHERE id = $1',
    [canonicalRecipeId]
  );
}

async function recordLogged(canonicalRecipeId) {
  if (!canonicalRecipeId) return;
  await pool.query(
    'UPDATE canonical_recipes SET logged_count = logged_count + 1, updated_at = now() WHERE id = $1',
    [canonicalRecipeId]
  );
}

module.exports = {
  normalizeTitle,
  ingredientSignature,
  linkOrCreate,
  topPopularForContext,
  recordReactionRollup,
  recordScheduleAdd,
  recordLogged,
};
