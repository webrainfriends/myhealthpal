const { getAiClient } = require('../../ai/privacyGateway');
const config = require('../../config');
const { recordAiUsage, FEATURES } = require('../../services/aiUsageService');
const { NUTRIENT_FIELDS, nutrientToolProperties } = require('./nutrientFields');

// The manual-entry counterpart to dietPhotoProvider.js: instead of reading
// a photo, this estimates a food/drink's nutrition from a plain-text name
// typed by the person logging it - so a manual entry gets the same AI
// nutrition estimate a photo scan gets, rather than requiring the person to
// look up and type every number themselves.
const SYSTEM_PROMPT = [
  'You are a precise nutrition-estimation engine for a plain-text food/drink description typed by a person logging',
  'what they ate or drank.',
  'The description may name a single ingredient (e.g. "banana", "2 slices whole wheat bread") or a prepared dish or',
  'recipe by its common name (e.g. "chicken biryani", "vegetable lasagna", "caesar salad", "butter chicken") - for a',
  'named dish, estimate its nutrition from the typical, standard recipe and composition for that dish (the way a',
  'nutrition database or cookbook would), not just from its single most prominent named ingredient.',
  'A shorthand, informally spelled, or regional name for a real dish should still be recognized and estimated using',
  'your best understanding of what it commonly refers to.',
  'If a quantity/serving is stated in the description, or given separately, estimate for exactly that amount;',
  'otherwise estimate for one typical serving of that food/dish, and report that assumed serving as quantity_amount,',
  'quantity_unit, and serving_size_grams so the person can see what "1 serving" was taken to mean.',
  'Use standard nutritional data (e.g. USDA FoodData Central-style values, or typical recipe nutrition data for named',
  'dishes) for calories, macros (protein/carbs/fat/saturated fat/fiber/sugar), and key micronutrients (sodium,',
  'cholesterol, potassium, calcium, iron, vitamin D).',
  'It is fine to leave an individual micronutrient null if standard data does not have a well-known value for it -',
  'never fabricate a precise-looking number you are not reasonably confident of.',
  'Only set recognized to false if the description is too vague, garbled, or unrelated to food/drink to identify any',
  'plausible item at all (e.g. random characters, an empty description) - never for a real dish just because it is',
  'informally named.',
  'This is a data-capture task, not a dietary-advice one: never add commentary about whether the food is healthy.',
].join(' ');

const ESTIMATE_TOOL = {
  name: 'estimate_food_nutrition',
  description:
    'Estimate the nutrition profile for one plain-text food/drink/recipe description, at the quantity given or for ' +
    'one typical serving if none was given. Never fabricate an estimate for a description that cannot be identified ' +
    'as any plausible food/drink - set recognized to false instead.',
  input_schema: {
    type: 'object',
    properties: {
      recognized: {
        type: 'boolean',
        description: 'False only if the description could not be identified as any plausible food/drink at all.',
      },
      matched_food_description: {
        type: ['string', 'null'],
        description:
          'A short description of what was recognized and estimated, e.g. "Chicken biryani - a mixed rice dish with ' +
          'chicken and spices, ~1.5 cups". Null if not recognized.',
      },
      quantity_amount: {
        type: ['number', 'null'],
        description: 'The portion amount estimated for - the one given, or a typical serving amount. Null if not recognized.',
      },
      quantity_unit: {
        type: ['string', 'null'],
        enum: ['g', 'ml', 'serving', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other', null],
      },
      serving_size_grams: { type: ['number', 'null'], description: 'Approximate grams for the estimated portion, or null.' },
      ...nutrientToolProperties('the quantity estimated for'),
      confidence: { type: 'number', description: '0-1 confidence in the identification and estimate.' },
    },
    required: ['recognized', 'confidence'],
  },
};

function buildUserMessage(description, quantityAmount, quantityUnit) {
  const parts = [`Food/drink description: "${description}"`];
  if (typeof quantityAmount === 'number' && quantityUnit) {
    parts.push(`Estimate for exactly this quantity: ${quantityAmount} ${quantityUnit}.`);
  } else {
    parts.push('No quantity was given - estimate for one typical serving and report what that serving is.');
  }
  return parts.join(' ');
}

const EMPTY_RESULT = {
  recognized: false,
  matchedFoodDescription: null,
  quantityAmount: null,
  quantityUnit: null,
  servingSizeGrams: null,
  nutrients: {},
  confidence: 0,
};

// Pure normalization of one tool-call result - exported/tested separately
// from the live API call, the same way claudeProvider.test.js tests
// buildContent() without hitting the network.
function mapEstimateResult(input) {
  if (!input || typeof input !== 'object') return { ...EMPTY_RESULT };

  const recognized = Boolean(input.recognized);
  const nutrients = {};
  for (const field of NUTRIENT_FIELDS) {
    nutrients[field] = recognized && typeof input[field] === 'number' ? input[field] : null;
  }

  return {
    recognized,
    matchedFoodDescription: recognized ? input.matched_food_description || null : null,
    quantityAmount: recognized && typeof input.quantity_amount === 'number' ? input.quantity_amount : null,
    quantityUnit: recognized ? input.quantity_unit || null : null,
    servingSizeGrams: recognized && typeof input.serving_size_grams === 'number' ? input.serving_size_grams : null,
    nutrients,
    confidence: typeof input.confidence === 'number' ? input.confidence : 0,
  };
}

// Provider-agnostic contract: estimate(description, {quantityAmount,
// quantityUnit}) -> { recognized, matchedFoodDescription, quantityAmount,
// quantityUnit, servingSizeGrams, nutrients, confidence, warnings }.
async function estimate(description, { quantityAmount, quantityUnit, userId } = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('AI nutrition estimation requires ANTHROPIC_API_KEY to be set.');
  }
  if (!description || !String(description).trim()) {
    return { ...EMPTY_RESULT, warnings: ['No food description was given.'] };
  }

  const client = await getAiClient({ subjectUserId: userId, purpose: 'diet_text_estimate' });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [ESTIMATE_TOOL],
    tool_choice: { type: 'tool', name: ESTIMATE_TOOL.name },
    messages: [{ role: 'user', content: buildUserMessage(description, quantityAmount, quantityUnit) }],
  });
  recordAiUsage(FEATURES.DIET_TEXT, response);

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { ...EMPTY_RESULT, warnings: ['No structured estimate was returned.'] };
  }

  return { ...mapEstimateResult(toolUse.input), warnings: [] };
}

module.exports = { name: 'claude', estimate, mapEstimateResult, buildUserMessage };
