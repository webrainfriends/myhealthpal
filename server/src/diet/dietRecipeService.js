const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const config = require('../config');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { NUTRIENT_FIELDS, nutrientToolProperties } = require('../extraction/providers/nutrientFields');
const { computeConsiderations, fetchActiveMedications, fetchAbnormalDietRelevantLabs } = require('./dietInsightService');

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

// Mirrors routes/activity.js's fixed, app-wide daily goals - duplicated
// rather than imported so this service doesn't depend on a route module;
// see that file's own comment for why these aren't yet per-user.
const ACTIVITY_GOALS = { steps: 10000, exerciseMinutes: 30 };

// Mirrors routes/recipePreferences.js's allow-lists/defaults - duplicated
// for the same reason (a service shouldn't import a route module).
const DEFAULT_DIET_TYPES = ['vegetarian', 'vegan'];
const DEFAULT_CUISINES = ['south_indian', 'western'];

// AI recipe generation, grounded the same way diet recommendations are:
// computeConsiderations() (dietInsightService.js) turns the person's active
// medications and abnormal-flagged lab results into a short list of real
// dietary considerations (e.g. "blood sugar management"), and the model is
// only allowed to explain a recipe's fit in terms of considerations it was
// actually given - never a fabricated health rationale.
const SAFETY_TAIL =
  ' This is an AI-generated recipe suggestion, not medical or dietary advice - check with a healthcare professional ' +
  'or dietitian if you have specific dietary restrictions.';

const SYSTEM_PROMPT = [
  'You are a nutrition-aware recipe generator.',
  'Given a meal type, optional free-text preferences (ingredients on hand, dietary restrictions, cuisine, etc.), and a',
  'list of the person\'s real dietary considerations (drawn from their active medications and lab results - e.g.',
  '"blood sugar management" or "blood pressure management"), generate one complete, realistic recipe a home cook',
  'could actually follow.',
  'When considerations are given, let them meaningfully shape the recipe (e.g. lower sodium for a blood-pressure',
  'consideration, steadier/lower added sugar for a blood-sugar consideration, fiber-forward and lower saturated fat',
  'for a cholesterol consideration) and explain briefly, in why_this_recipe, how it does - citing ONLY the',
  'considerations actually given, never inventing a health rationale that was not provided.',
  'If no considerations are given, why_this_recipe should describe why the recipe fits the requested meal type/',
  'preferences instead, with no health claims at all.',
  'Respect any stated preference/restriction (e.g. vegetarian, an allergy, an ingredient to avoid) as a hard',
  'constraint, never a suggestion to override.',
  'Estimate the nutrition per serving using standard nutritional data, the same way you would when logging a food.',
  'This is a recipe-generation task, not a diagnosis or treatment plan: never suggest a medication change and never',
  'claim the recipe treats or cures a condition.',
].join(' ');

const RECIPE_TOOL = {
  name: 'generate_recipe',
  description: 'Generate one complete recipe: ingredients, ordered instructions, and estimated nutrition per serving.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string', description: 'One or two sentence overview of the dish.' },
      servings: { type: 'number' },
      prep_time_minutes: { type: ['number', 'null'] },
      cook_time_minutes: { type: ['number', 'null'] },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            amount: { type: 'string', description: 'e.g. "2 cups", "1 tbsp", "to taste".' },
          },
          required: ['item', 'amount'],
        },
      },
      instructions: { type: 'array', items: { type: 'string' }, description: 'Ordered step-by-step instructions.' },
      dietary_tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'e.g. "vegetarian", "high-fiber", "low-sodium" - only tags that genuinely apply.',
      },
      why_this_recipe: {
        type: 'string',
        description: 'Why this recipe fits the request/considerations given - see system prompt for the grounding rule.',
      },
      ...nutrientToolProperties('one serving of this recipe'),
    },
    required: ['title', 'description', 'servings', 'ingredients', 'instructions', 'why_this_recipe'],
  },
};

function buildUserMessage({ mealType, preferences, considerations }) {
  const parts = [
    mealType ? `Meal type: ${mealType}.` : 'Meal type: not specified - any meal is fine.',
    preferences && preferences.trim() ? `Preferences/constraints: ${preferences.trim()}.` : 'No specific preferences given.',
  ];
  parts.push(
    considerations.length > 0
      ? `Real dietary considerations for this person (from their active medications/lab results): ${considerations.map((c) => c.label).join(', ')}.`
      : 'No dietary considerations are on file for this person.'
  );
  return parts.join(' ');
}

// Pure normalization of one tool-call result - exported/tested separately
// from the live API call, the same way dietTextProvider.js's
// mapEstimateResult is.
function mapRecipeResult(input) {
  if (!input || typeof input !== 'object') return null;

  const nutritionPerServing = {};
  for (const field of NUTRIENT_FIELDS) {
    nutritionPerServing[field] = typeof input[field] === 'number' ? input[field] : null;
  }

  return {
    title: input.title ? String(input.title) : 'Untitled recipe',
    // Only present on a batch (generate_recipes) result - a single
    // generate_recipe result carries no meal_type input and maps to null.
    mealType: MEAL_TYPES.includes(input.meal_type) ? input.meal_type : null,
    description: input.description ? String(input.description) : null,
    servings: typeof input.servings === 'number' ? input.servings : null,
    prepTimeMinutes: typeof input.prep_time_minutes === 'number' ? input.prep_time_minutes : null,
    cookTimeMinutes: typeof input.cook_time_minutes === 'number' ? input.cook_time_minutes : null,
    ingredients: Array.isArray(input.ingredients)
      ? input.ingredients.filter((i) => i && i.item).map((i) => ({ item: String(i.item), amount: i.amount ? String(i.amount) : '' }))
      : [],
    instructions: Array.isArray(input.instructions) ? input.instructions.filter((s) => typeof s === 'string' && s.trim()) : [],
    dietaryTags: Array.isArray(input.dietary_tags) ? input.dietary_tags.filter((t) => typeof t === 'string' && t.trim()) : [],
    whyThisRecipe: input.why_this_recipe ? `${input.why_this_recipe}${SAFETY_TAIL}` : null,
    nutritionPerServing,
  };
}

// context lets the route pass in medications/abnormalLabs it may have
// already fetched elsewhere in the same request; omit it and this fetches
// them itself.
async function generateRecipe(userId, { mealType, preferences } = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('AI recipe generation requires ANTHROPIC_API_KEY to be set.');
  }

  const [medications, abnormalLabs] = await Promise.all([
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
  ]);
  const considerations = computeConsiderations(medications, abnormalLabs);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [RECIPE_TOOL],
    tool_choice: { type: 'tool', name: RECIPE_TOOL.name },
    messages: [{ role: 'user', content: buildUserMessage({ mealType, preferences, considerations }) }],
  });
  recordAiUsage(FEATURES.RECIPES, response);

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const recipe = toolUse ? mapRecipeResult(toolUse.input) : null;

  return { recipe, considerations: considerations.map((c) => ({ key: c.key, label: c.label })) };
}

// The same fixed daily goals routes/activity.js scores rings against -
// used here only to describe activity level in words (e.g. "low activity"),
// never to change what's stored.
async function fetchRecentActivity(userId, windowDays = 14) {
  const { rows } = await pool.query(
    `SELECT steps, exercise_minutes FROM activity_logs
     WHERE user_id = $1 AND log_date >= CURRENT_DATE - ($2::int - 1)`,
    [userId, windowDays]
  );
  return rows;
}

function describeActivity(rows) {
  const loggedSteps = rows.filter((r) => r.steps != null);
  const loggedExercise = rows.filter((r) => r.exercise_minutes != null);
  if (loggedSteps.length === 0 && loggedExercise.length === 0) return null;

  const avgSteps = loggedSteps.length > 0
    ? Math.round(loggedSteps.reduce((sum, r) => sum + r.steps, 0) / loggedSteps.length)
    : null;
  const avgExerciseMinutes = loggedExercise.length > 0
    ? Math.round(loggedExercise.reduce((sum, r) => sum + r.exercise_minutes, 0) / loggedExercise.length)
    : null;

  const level = avgSteps == null
    ? null
    : avgSteps >= ACTIVITY_GOALS.steps
      ? 'active'
      : avgSteps >= ACTIVITY_GOALS.steps * 0.5
        ? 'moderately active'
        : 'low activity';

  return { avgSteps, avgExerciseMinutes, level };
}

async function fetchWeightGoal(userId) {
  const { rows } = await pool.query('SELECT * FROM user_weight_goals WHERE user_id = $1', [userId]);
  const row = rows[0];
  if (!row || (row.current_weight_kg == null && row.target_weight_kg == null)) return null;
  return {
    currentWeightKg: row.current_weight_kg != null ? Number(row.current_weight_kg) : null,
    targetWeightKg: row.target_weight_kg != null ? Number(row.target_weight_kg) : null,
    targetDate: row.target_date ? new Date(row.target_date).toISOString().slice(0, 10) : null,
  };
}

async function fetchRecipePreferences(userId) {
  const { rows } = await pool.query(
    'SELECT preference_type, preference_value FROM user_recipe_preferences WHERE user_id = $1',
    [userId]
  );
  if (rows.length === 0) return { dietTypes: DEFAULT_DIET_TYPES, cuisines: DEFAULT_CUISINES };
  return {
    dietTypes: rows.filter((r) => r.preference_type === 'diet_type').map((r) => r.preference_value),
    cuisines: rows.filter((r) => r.preference_type === 'cuisine').map((r) => r.preference_value),
  };
}

function describeWeightGoalForPrompt(weightGoal) {
  if (!weightGoal || weightGoal.currentWeightKg == null || weightGoal.targetWeightKg == null) {
    return 'No weight goal is on file for this person.';
  }
  const { currentWeightKg, targetWeightKg, targetDate } = weightGoal;
  const direction = targetWeightKg < currentWeightKg ? 'lose' : targetWeightKg > currentWeightKg ? 'gain' : 'maintain';
  const byDate = targetDate ? ` by ${targetDate}` : '';
  return `This person's weight goal: ${direction} weight, from ${currentWeightKg}kg toward a target of ${targetWeightKg}kg${byDate}.`;
}

function describeActivityForPrompt(activity) {
  if (!activity || activity.level == null) return 'No recent activity data is on file for this person.';
  const exercisePart = activity.avgExerciseMinutes != null ? `, ${activity.avgExerciseMinutes} exercise minutes/day` : '';
  return `Recent activity level: ${activity.level} (averaging ${activity.avgSteps} steps/day${exercisePart}).`;
}

function describePreferencesForPrompt(preferences) {
  const dietPart = preferences.dietTypes.length > 0
    ? preferences.dietTypes.join('/').replace(/_/g, ' ')
    : 'no specific diet type';
  const cuisinePart = preferences.cuisines.length > 0
    ? preferences.cuisines.map((c) => c.replace(/_/g, ' ')).join('/')
    : 'no specific cuisine';
  return `Preferred diet type(s): ${dietPart}. Preferred cuisine(s): ${cuisinePart}.`;
}

const FEED_SYSTEM_PROMPT = [
  'You are a nutrition-aware recipe generator producing a personalized batch of recipe ideas automatically - the',
  'person has not typed any request, so you must infer what would help them from the real signals given: their',
  'dietary considerations (from active medications/abnormal lab results), recent activity level, weight goal, and',
  'saved diet-type/cuisine preferences.',
  'Generate the requested number of complete, distinct, realistic recipes a home cook could actually follow. Vary',
  'them across meal types (breakfast/lunch/snack/dinner/supper) unless a single meal type was requested, and make',
  'sure no two recipes in the batch are near-duplicates of each other or of any title in the "already suggested"',
  'list.',
  'Respect every stated diet-type/cuisine preference as a hard constraint, never a suggestion to override.',
  'When dietary considerations are given, let them meaningfully shape each recipe (e.g. lower sodium for a',
  'blood-pressure consideration, steadier/lower added sugar for a blood-sugar consideration, fiber-forward and',
  'lower saturated fat for a cholesterol consideration) and explain briefly, in why_this_recipe, how it does -',
  'citing ONLY the considerations actually given, never inventing a health rationale that was not provided.',
  'When a weight-loss goal is given, favor a sensible calorie-per-serving for that goal; when an activity level is',
  'given, favor higher-protein/higher-energy recipes for an active person and lighter, nutrient-dense ones for a',
  'low-activity person - mention either in why_this_recipe only when it genuinely applies to that recipe. If none',
  'of these signals apply to a given recipe, why_this_recipe should describe why it fits the meal type/preferences',
  'instead, with no health claims at all.',
  'Estimate the nutrition per serving using standard nutritional data, the same way you would when logging a food.',
  'Keep each recipe concise: a one-sentence description, at most 10 ingredients, at most 8 short instruction steps,',
  'and a why_this_recipe of one or two sentences.',
  'This is a recipe-generation task, not a diagnosis or treatment plan: never suggest a medication change and',
  'never claim a recipe treats or cures a condition.',
].join(' ');

// Recipes per feed request. Each one is roughly 800-1,200 output tokens
// (13 nutrient fields, ingredients, steps), so a small batch keeps the cost
// of one "Generate" tap predictable. The per-recipe output budget has
// headroom so a batch finishes instead of being cut off: a cut-off tool
// call used to lose the *whole* batch while still being billed for it.
const FEED_MAX_COUNT = 5;
const FEED_OUTPUT_TOKENS_PER_RECIPE = 1500;

const RECIPE_LIST_TOOL = {
  name: 'generate_recipes',
  description:
    'Generate a batch of complete, distinct recipes: ingredients, ordered instructions, and estimated nutrition per serving for each.',
  input_schema: {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            meal_type: { type: 'string', enum: MEAL_TYPES, description: 'Which meal this recipe is best suited for.' },
            description: { type: 'string', description: 'One or two sentence overview of the dish.' },
            servings: { type: 'number' },
            prep_time_minutes: { type: ['number', 'null'] },
            cook_time_minutes: { type: ['number', 'null'] },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  amount: { type: 'string', description: 'e.g. "2 cups", "1 tbsp", "to taste".' },
                },
                required: ['item', 'amount'],
              },
            },
            instructions: { type: 'array', items: { type: 'string' }, description: 'Ordered step-by-step instructions.' },
            dietary_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'e.g. "vegetarian", "high-fiber", "low-sodium" - only tags that genuinely apply.',
            },
            why_this_recipe: {
              type: 'string',
              description: "Why this recipe fits this person's signals - see system prompt for the grounding rule.",
            },
            ...nutrientToolProperties('one serving of this recipe'),
          },
          required: ['title', 'meal_type', 'description', 'servings', 'ingredients', 'instructions', 'why_this_recipe'],
        },
      },
    },
    required: ['recipes'],
  },
};

function buildFeedUserMessage({ mealType, count, considerations, activity, weightGoal, preferences, excludeTitles }) {
  const parts = [
    `Generate ${count} recipes.`,
    mealType ? `Meal type: all should be ${mealType}.` : 'Meal type: vary across breakfast/lunch/snack/dinner/supper.',
    describePreferencesForPrompt(preferences),
    considerations.length > 0
      ? `Real dietary considerations for this person (from their active medications/lab results): ${considerations.map((c) => c.label).join(', ')}.`
      : 'No dietary considerations are on file for this person.',
    describeActivityForPrompt(activity),
    describeWeightGoalForPrompt(weightGoal),
  ];
  if (excludeTitles.length > 0) {
    parts.push(`Do not repeat any of these already-suggested recipe titles: ${excludeTitles.join('; ')}.`);
  }
  return parts.join(' ');
}

// The usable recipes in a feed response. When the output was cut off at
// max_tokens, the last recipe in the partially-parsed array is the one
// being written at the cutoff - its ingredients, steps, or nutrition may be
// missing even if it looks well-formed - so it is dropped. Anything without
// a title, ingredients, and instructions is dropped too, rather than shown
// as a recipe nobody could cook.
function completeRecipesFrom(response) {
  const toolUse = response?.content?.find((block) => block.type === 'tool_use');
  let rawRecipes = Array.isArray(toolUse?.input?.recipes) ? toolUse.input.recipes : [];
  if (response?.stop_reason === 'max_tokens') rawRecipes = rawRecipes.slice(0, -1);
  return rawRecipes
    .map(mapRecipeResult)
    .filter((r) => r && r.title !== 'Untitled recipe' && r.ingredients.length > 0 && r.instructions.length > 0);
}

// Auto-generates a personalized batch of recipes with no meal type or free
// text typed by the user - grounded the same way generateRecipe() is, plus
// recent activity, weight goal, and saved diet-type/cuisine preferences.
// excludeTitles lets the caller page through without repeats: the mobile
// "Generate more" button passes every title already shown so far.
async function generateRecipeFeed(userId, { mealType, count = FEED_MAX_COUNT, excludeTitles = [] } = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('AI recipe generation requires ANTHROPIC_API_KEY to be set.');
  }

  const [medications, abnormalLabs, activityRows, weightGoal, preferences] = await Promise.all([
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
    fetchRecentActivity(userId),
    fetchWeightGoal(userId),
    fetchRecipePreferences(userId),
  ]);
  const considerations = computeConsiderations(medications, abnormalLabs);
  const activity = describeActivity(activityRows);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  // Streamed rather than .create(): if the output does hit max_tokens, the
  // SDK's stream still partially parses the cut-off tool input, so every
  // recipe finished before the cutoff is kept (see completeRecipesFrom)
  // instead of the whole paid-for batch coming back empty.
  const response = await client.messages
    .stream({
      model: config.anthropicModel,
      max_tokens: FEED_OUTPUT_TOKENS_PER_RECIPE * count + 512,
      system: FEED_SYSTEM_PROMPT,
      tools: [RECIPE_LIST_TOOL],
      tool_choice: { type: 'tool', name: RECIPE_LIST_TOOL.name },
      messages: [
        {
          role: 'user',
          content: buildFeedUserMessage({ mealType, count, considerations, activity, weightGoal, preferences, excludeTitles }),
        },
      ],
    })
    .finalMessage();
  recordAiUsage(FEATURES.RECIPES, response);

  const excludeTitlesLower = new Set(excludeTitles.map((t) => t.toLowerCase().trim()));
  const recipes = completeRecipesFrom(response).filter((r) => !excludeTitlesLower.has(r.title.toLowerCase().trim()));

  return {
    recipes,
    considerations: considerations.map((c) => ({ key: c.key, label: c.label })),
    signals: {
      activityLevel: activity?.level || null,
      weightGoalSet: Boolean(weightGoal),
      dietTypes: preferences.dietTypes,
      cuisines: preferences.cuisines,
    },
  };
}

module.exports = {
  generateRecipe,
  generateRecipeFeed,
  completeRecipesFrom,
  FEED_MAX_COUNT,
  mapRecipeResult,
  buildUserMessage,
  buildFeedUserMessage,
  describeActivity,
};
