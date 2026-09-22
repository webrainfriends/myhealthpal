const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { NUTRIENT_FIELDS, nutrientToolProperties } = require('../extraction/providers/nutrientFields');
const { computeConsiderations, fetchActiveMedications, fetchAbnormalDietRelevantLabs } = require('./dietInsightService');

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

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const recipe = toolUse ? mapRecipeResult(toolUse.input) : null;

  return { recipe, considerations: considerations.map((c) => ({ key: c.key, label: c.label })) };
}

module.exports = { generateRecipe, mapRecipeResult, buildUserMessage };
