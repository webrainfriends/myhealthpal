const pool = require('../db/pool');
const config = require('../config');
const { getAiClient } = require('../ai/privacyGateway');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { nutrientToolProperties } = require('../extraction/providers/nutrientFields');
const { computeConsiderations, fetchActiveMedications, fetchAbnormalDietRelevantLabs } = require('../diet/dietInsightService');
const dietRecipeService = require('../diet/dietRecipeService');
const kitchenService = require('../kitchen/kitchenService');
const recipeCatalogService = require('../recipes/recipeCatalogService');
const recipeBackfillService = require('./recipeBackfillService');
const scheduleService = require('./scheduleService');

// Generates a full diet schedule constrained to a "mini kitchen" ingredient
// selection (requirement 3), respecting the person's saved cuisine/diet-type
// preferences (recipePreferences.js/dietRecipeService.fetchRecipePreferences)
// and, advisorily, what similar users have reacted well to
// (recipeCatalogService.topPopularForContext).

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];
const DEFAULT_MEALS_PER_DAY = ['breakfast', 'lunch', 'dinner'];

// A day at a time keeps each call's output bounded well under a truncation
// risk - same reasoning as dietRecipeService.js's FEED_MAX_COUNT/
// FEED_OUTPUT_TOKENS_PER_RECIPE comment, just scaled to a multi-day batch
// instead of a single feed request.
const DAYS_PER_BATCH = 3;
const OUTPUT_TOKENS_PER_RECIPE = 1500;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

const KITCHEN_SYSTEM_PROMPT = [
  'You are a nutrition-aware recipe generator building a multi-day diet schedule for a person from ingredients they',
  'already have on hand.',
  'Generate exactly one complete, realistic recipe for each requested day/meal slot, in the order given.',
  'Primarily use the on-hand ingredients listed; you may add a small number of common pantry staples not listed',
  '(salt, oil, water, basic spices) but must not introduce a main ingredient the person does not have.',
  'Respect every stated diet-type/cuisine preference as a hard constraint, never a suggestion to override.',
  'When dietary considerations are given, let them meaningfully shape each recipe (e.g. lower sodium for a',
  'blood-pressure consideration, steadier/lower added sugar for a blood-sugar consideration, fiber-forward and lower',
  'saturated fat for a cholesterol consideration) and explain briefly, in why_this_recipe, how it does - citing ONLY',
  'the considerations actually given, never inventing a health rationale that was not provided.',
  'Popular recipes from other users, when given, are inspiration only - never copy one verbatim if the on-hand',
  'ingredients do not support it.',
  'Estimate the nutrition per serving using standard nutritional data, the same way you would when logging a food.',
  'Vary the recipes across the schedule - avoid near-duplicate dishes on different days unless the ingredients on hand',
  'genuinely leave little alternative.',
  'This is a recipe-generation task, not a diagnosis or treatment plan: never suggest a medication change and never',
  'claim a recipe treats or cures a condition.',
].join(' ');

const KITCHEN_SCHEDULE_TOOL = {
  name: 'generate_kitchen_schedule',
  description: 'Generate one complete recipe for each requested day/meal slot of a kitchen-constrained diet schedule.',
  input_schema: {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day_number: { type: 'number', description: 'Which requested day/meal slot this recipe fills.' },
            meal_type: { type: 'string', enum: MEAL_TYPES },
            title: { type: 'string' },
            description: { type: 'string', description: 'One or two sentence overview of the dish.' },
            servings: { type: 'number' },
            prep_time_minutes: { type: ['number', 'null'] },
            cook_time_minutes: { type: ['number', 'null'] },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: { item: { type: 'string' }, amount: { type: 'string' } },
                required: ['item', 'amount'],
              },
            },
            instructions: { type: 'array', items: { type: 'string' }, description: 'Ordered step-by-step instructions.' },
            dietary_tags: { type: 'array', items: { type: 'string' } },
            why_this_recipe: { type: 'string' },
            ...nutrientToolProperties('one serving of this recipe'),
          },
          required: ['day_number', 'meal_type', 'title', 'description', 'servings', 'ingredients', 'instructions', 'why_this_recipe'],
        },
      },
    },
    required: ['recipes'],
  },
};

function buildDayMealSlots(durationDays, mealTypesPerDay) {
  const slots = [];
  for (let day = 1; day <= durationDays; day += 1) {
    for (const mealType of mealTypesPerDay) slots.push({ dayNumber: day, mealType });
  }
  return slots;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function describeKitchenItems(items) {
  if (items.length === 0) return 'No specific on-hand ingredients were selected - use general, widely available ingredients.';
  return `On-hand ingredients to primarily build the schedule around: ${items.map((i) => i.name).join(', ')}.`;
}

function describePopular(popular) {
  if (popular.length === 0) return '';
  return `Popular recipes other users with similar preferences have loved (inspiration only): ${popular
    .map((p) => p.title)
    .join('; ')}.`;
}

async function generateBatch({ userId, slots, considerations, preferences, kitchenItems, popular }) {
  const client = await getAiClient({ subjectUserId: userId, purpose: 'recipe' });
  const slotsDescription = slots.map((s) => `Day ${s.dayNumber} ${s.mealType}`).join('; ');
  const userMessage = [
    `Generate exactly ${slots.length} recipes, one for each of these day/meal slots: ${slotsDescription}.`,
    describeKitchenItems(kitchenItems),
    dietRecipeService.describePreferencesForPrompt(preferences),
    considerations.length > 0
      ? `Real dietary considerations for this person: ${considerations.map((c) => c.label).join(', ')}.`
      : 'No dietary considerations are on file for this person.',
    describePopular(popular),
  ]
    .filter(Boolean)
    .join(' ');

  const response = await client.messages.streamFinal({
    model: config.anthropicModel,
    max_tokens: OUTPUT_TOKENS_PER_RECIPE * slots.length + 512,
    system: KITCHEN_SYSTEM_PROMPT,
    tools: [KITCHEN_SCHEDULE_TOOL],
    tool_choice: { type: 'tool', name: KITCHEN_SCHEDULE_TOOL.name },
    messages: [{ role: 'user', content: userMessage }],
  });
  recordAiUsage(FEATURES.RECIPES, response);

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  let rawRecipes = Array.isArray(toolUse?.input?.recipes) ? toolUse.input.recipes : [];
  // Same truncation guard as dietRecipeService.completeRecipesFrom: the last
  // entry in a max_tokens-cut batch may be a partially-written recipe.
  if (response.stop_reason === 'max_tokens') rawRecipes = rawRecipes.slice(0, -1);

  return rawRecipes
    .map((r) => ({
      dayNumber: Number.isFinite(r.day_number) ? Math.round(r.day_number) : null,
      mealType: MEAL_TYPES.includes(r.meal_type) ? r.meal_type : null,
      recipe: dietRecipeService.mapRecipeResult(r),
    }))
    .filter(
      (x) =>
        x.dayNumber != null &&
        x.mealType &&
        x.recipe &&
        x.recipe.title !== 'Untitled recipe' &&
        x.recipe.ingredients.length > 0 &&
        x.recipe.instructions.length > 0
    );
}

async function generateFromKitchen(userId, { title, durationDays, startDate, kitchenItemIds, mealTypesPerDay } = {}) {
  const duration = Number(durationDays);
  if (!scheduleService.DURATIONS.includes(duration)) throw httpError('durationDays must be 7 or 15.', 400);
  if (!startDate || Number.isNaN(new Date(startDate).getTime())) throw httpError('startDate is required (YYYY-MM-DD).', 400);

  const meals = Array.isArray(mealTypesPerDay) && mealTypesPerDay.length > 0
    ? [...new Set(mealTypesPerDay.filter((m) => MEAL_TYPES.includes(m)))]
    : DEFAULT_MEALS_PER_DAY;
  if (meals.length === 0) throw httpError('mealTypesPerDay must include at least one valid meal type.', 400);

  const [kitchenItems, medications, abnormalLabs, preferences] = await Promise.all([
    kitchenService.fetchAvailableKitchenItems(userId, kitchenItemIds || []),
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
    dietRecipeService.fetchRecipePreferences(userId),
  ]);
  const considerations = computeConsiderations(medications, abnormalLabs);
  const cuisine = preferences.cuisines[0] || null;
  const dietType = preferences.dietTypes[0] || null;
  const popular = await recipeCatalogService.topPopularForContext({ cuisine, dietType });

  const slots = buildDayMealSlots(duration, meals);
  const batches = chunk(slots, DAYS_PER_BATCH * meals.length);

  const generated = [];
  for (const batch of batches) {
    // eslint-disable-next-line no-await-in-loop
    const results = await generateBatch({ userId, slots: batch, considerations, preferences, kitchenItems, popular });
    generated.push(...results);
  }

  // Keep only one result per requested slot, and only for slots actually
  // requested - a model deviating from the exact count/order asked for
  // never gets to smuggle an extra or mismatched day/meal into the schedule.
  const validSlotKeys = new Set(slots.map((s) => `${s.dayNumber}:${s.mealType}`));
  const seenSlotKeys = new Set();
  const dedupedGenerated = [];
  for (const item of generated) {
    const key = `${item.dayNumber}:${item.mealType}`;
    if (!validSlotKeys.has(key) || seenSlotKeys.has(key)) continue;
    seenSlotKeys.add(key);
    dedupedGenerated.push(item);
  }

  const { rows } = await pool.query(
    `INSERT INTO diet_schedules (user_id, title, duration_days, start_date, source_type, kitchen_item_ids)
     VALUES ($1, $2, $3, $4, 'kitchen_generated', $5) RETURNING *`,
    [
      userId,
      title && title.trim() ? title.trim() : `${duration}-day kitchen schedule`,
      duration,
      startDate,
      JSON.stringify(kitchenItems.map((i) => i.id)),
    ]
  );
  const schedule = rows[0];

  for (const { dayNumber, mealType, recipe } of dedupedGenerated) {
    // eslint-disable-next-line no-await-in-loop
    const saved = await dietRecipeService.saveScheduleRecipeSuggestion(userId, recipe, mealType);
    // eslint-disable-next-line no-await-in-loop
    const canonicalId = await recipeCatalogService.linkOrCreate(saved.id, saved, { cuisine, dietType });
    if (canonicalId) {
      // eslint-disable-next-line no-await-in-loop
      await recipeCatalogService.recordScheduleAdd(canonicalId);
    }
    const scheduledDate = scheduleService.addDays(startDate, dayNumber - 1);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO diet_schedule_entries (schedule_id, day_number, scheduled_date, meal_type, dish_name, recipe_suggestion_id, recipe_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'generated')`,
      [schedule.id, dayNumber, scheduledDate, mealType, saved.title, saved.id]
    );
  }

  // Any slot the model skipped still gets a placeholder entry, backfilled
  // the normal way - requirement 4 (every entry ends up with a real recipe)
  // holds even when a generation batch comes back incomplete.
  const missingSlots = slots.filter((s) => !seenSlotKeys.has(`${s.dayNumber}:${s.mealType}`));
  for (const slot of missingSlots) {
    const scheduledDate = scheduleService.addDays(startDate, slot.dayNumber - 1);
    const placeholderName = `${slot.mealType.charAt(0).toUpperCase()}${slot.mealType.slice(1)} (day ${slot.dayNumber})`;
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO diet_schedule_entries (schedule_id, day_number, scheduled_date, meal_type, dish_name, recipe_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [schedule.id, slot.dayNumber, scheduledDate, slot.mealType, placeholderName]
    );
  }
  if (missingSlots.length > 0) recipeBackfillService.enqueueBackfill(schedule.id);

  return scheduleService.getScheduleWithEntries(userId, schedule.id);
}

module.exports = { generateFromKitchen, MEAL_TYPES, DEFAULT_MEALS_PER_DAY };
