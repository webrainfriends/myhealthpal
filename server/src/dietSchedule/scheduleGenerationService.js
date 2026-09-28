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
const { logError } = require('../lib/safeLog');

// Generates a full diet schedule constrained to a "mini kitchen" ingredient
// selection (requirement 3), respecting the person's saved cuisine/diet-type
// preferences (recipePreferences.js/dietRecipeService.fetchRecipePreferences)
// and, advisorily, what similar users have reacted well to
// (recipeCatalogService.topPopularForContext).
//
// Split into a fast, synchronous "create" step (DB only - returns almost
// instantly) and a background "generate" step that makes the actual Claude
// calls, the same enqueue-then-poll shape scheduleImportService.js and
// recipeBackfillService.js already use. A 7-15 day schedule needs several
// sequential Claude calls (see DAYS_PER_BATCH below); doing that inline in
// the request handler is exactly what caused POST /api/diet-schedules/generate
// to 504 behind a reverse-proxy/gateway timeout - the route now returns as
// soon as the schedule + pending entries exist, and the mobile detail
// screen's existing poll-while-pending/generating loop (built for manual/
// imported schedules) picks up each recipe as it finishes.

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];
const DEFAULT_MEALS_PER_DAY = ['breakfast', 'lunch', 'dinner'];

// A few slots at a time keeps each call's output bounded well under a
// truncation risk - same reasoning as dietRecipeService.js's FEED_MAX_COUNT/
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

function normalizeMealTypes(mealTypesPerDay) {
  const meals = Array.isArray(mealTypesPerDay) && mealTypesPerDay.length > 0
    ? [...new Set(mealTypesPerDay.filter((m) => MEAL_TYPES.includes(m)))]
    : DEFAULT_MEALS_PER_DAY;
  return meals;
}

// The actual AI work - runs in the background (see enqueueKitchenGeneration)
// after createKitchenSchedule has already returned the schedule with every
// slot as a 'pending' entry. Processes one batch at a time and updates the
// matching pending entries as soon as that batch's results are in, so
// recipes appear progressively rather than all at once at the very end.
async function processKitchenGeneration(scheduleId) {
  const { rows: scheduleRows } = await pool.query('SELECT * FROM diet_schedules WHERE id = $1', [scheduleId]);
  const schedule = scheduleRows[0];
  if (!schedule) return;

  const { rows: pendingEntries } = await pool.query(
    `SELECT id, day_number, meal_type FROM diet_schedule_entries WHERE schedule_id = $1 AND recipe_status = 'pending'`,
    [scheduleId]
  );
  if (pendingEntries.length === 0) return;

  const entryIdBySlot = new Map(pendingEntries.map((e) => [`${e.day_number}:${e.meal_type}`, e.id]));
  const kitchenItemIds = Array.isArray(schedule.kitchen_item_ids) ? schedule.kitchen_item_ids : [];

  try {
    const [kitchenItems, medications, abnormalLabs, preferences] = await Promise.all([
      kitchenService.fetchAvailableKitchenItems(schedule.user_id, kitchenItemIds),
      fetchActiveMedications(schedule.user_id),
      fetchAbnormalDietRelevantLabs(schedule.user_id),
      dietRecipeService.fetchRecipePreferences(schedule.user_id),
    ]);
    const considerations = computeConsiderations(medications, abnormalLabs);
    const cuisine = preferences.cuisines[0] || null;
    const dietType = preferences.dietTypes[0] || null;
    const popular = await recipeCatalogService.topPopularForContext({ cuisine, dietType });

    const slots = pendingEntries.map((e) => ({ dayNumber: e.day_number, mealType: e.meal_type }));
    const meals = normalizeMealTypes([...new Set(slots.map((s) => s.mealType))]);
    const batches = chunk(slots, DAYS_PER_BATCH * meals.length);

    for (const batch of batches) {
      // eslint-disable-next-line no-await-in-loop
      const results = await generateBatch({ userId: schedule.user_id, slots: batch, considerations, preferences, kitchenItems, popular });

      for (const { dayNumber, mealType, recipe } of results) {
        const entryId = entryIdBySlot.get(`${dayNumber}:${mealType}`);
        if (!entryId) continue; // model returned a slot that wasn't actually requested/pending
        entryIdBySlot.delete(`${dayNumber}:${mealType}`); // first match wins, same as the old dedup pass

        // eslint-disable-next-line no-await-in-loop
        const saved = await dietRecipeService.saveScheduleRecipeSuggestion(schedule.user_id, recipe, mealType);
        // eslint-disable-next-line no-await-in-loop
        const canonicalId = await recipeCatalogService.linkOrCreate(saved.id, saved, { cuisine, dietType });
        if (canonicalId) {
          // eslint-disable-next-line no-await-in-loop
          await recipeCatalogService.recordScheduleAdd(canonicalId);
        }
        // eslint-disable-next-line no-await-in-loop
        await pool.query(
          `UPDATE diet_schedule_entries SET dish_name = $1, recipe_suggestion_id = $2, recipe_status = 'generated', updated_at = now() WHERE id = $3`,
          [saved.title, saved.id, entryId]
        );
      }
    }
  } catch (err) {
    logError(`Unhandled error generating kitchen diet schedule ${scheduleId}`, err);
  }

  // Any slot the model skipped (or the whole generation failing, e.g. no AI
  // consent) still needs a real recipe - fall back to the same single-recipe
  // backfill path manual/imported entries use, keyed off the dish-name
  // placeholder createKitchenSchedule gave it, rather than leaving it
  // silently stuck on 'pending' forever.
  const stillPendingIds = [...entryIdBySlot.values()];
  for (const entryId of stillPendingIds) {
    recipeBackfillService.enqueueBackfillEntry(entryId);
  }
}

function enqueueKitchenGeneration(scheduleId) {
  setImmediate(() => {
    processKitchenGeneration(scheduleId).catch((err) => logError(`Unhandled error generating kitchen diet schedule ${scheduleId}`, err));
  });
}

// Fast, DB-only: validates input, snapshots the selected kitchen items, and
// creates the schedule with one 'pending' entry per day/meal slot - then
// hands off to the background generator above. Returns almost immediately,
// which is what fixes the request timing out behind a reverse proxy.
async function generateFromKitchen(userId, { title, durationDays, startDate, kitchenItemIds, mealTypesPerDay } = {}) {
  const duration = Number(durationDays);
  if (!scheduleService.DURATIONS.includes(duration)) throw httpError('durationDays must be 7 or 15.', 400);
  if (!startDate || Number.isNaN(new Date(startDate).getTime())) throw httpError('startDate is required (YYYY-MM-DD).', 400);

  const meals = normalizeMealTypes(mealTypesPerDay);
  if (meals.length === 0) throw httpError('mealTypesPerDay must include at least one valid meal type.', 400);

  const kitchenItems = await kitchenService.fetchAvailableKitchenItems(userId, kitchenItemIds || []);

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

  const slots = buildDayMealSlots(duration, meals);
  const placeholderEntries = slots.map((slot) => ({
    dayNumber: slot.dayNumber,
    mealType: slot.mealType,
    dishName: `${slot.mealType.charAt(0).toUpperCase()}${slot.mealType.slice(1)} (day ${slot.dayNumber})`,
  }));
  await scheduleService.insertEntries(schedule.id, startDate, placeholderEntries);

  enqueueKitchenGeneration(schedule.id);

  return scheduleService.getScheduleWithEntries(userId, schedule.id);
}

module.exports = { generateFromKitchen, MEAL_TYPES, DEFAULT_MEALS_PER_DAY };
