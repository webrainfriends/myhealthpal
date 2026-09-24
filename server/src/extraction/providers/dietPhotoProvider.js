const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');
const { recordAiUsage, FEATURES } = require('../../services/aiUsageService');
const { NUTRIENT_FIELDS, nutrientToolProperties } = require('./nutrientFields');

const SYSTEM_PROMPT = [
  'You are a precise food/drink identification and nutrition-estimation engine reading a photo of a meal, snack, or drink.',
  'Identify every distinct food or drink item visible.',
  'For each item, estimate calories, macros (protein/carbs/fat/saturated fat/fiber/sugar), and key micronutrients',
  '(sodium, cholesterol, potassium, calcium, iron, vitamin D) using standard nutritional data (e.g. USDA FoodData',
  'Central-style values) for what a typical serving of that food contains, scaled to the portion actually visible in',
  'the photo.',
  'If the portion size/quantity/serving cannot be confidently judged from the image (no visible package, no countable',
  'unit, an unfamiliar container), do not guess a number - leave quantity_amount, quantity_unit, and serving_size_grams',
  'null and set needs_quantity to true so the person is asked directly instead.',
  'If a packaged product\'s label with printed nutrition facts is legible in the photo, read the printed values exactly',
  'rather than estimating - including any micronutrients printed as a %DV, converted to the actual amount.',
  'It is fine to leave an individual micronutrient null if standard data for that specific food does not have a',
  'well-known value for it - never fabricate a precise-looking number for one you are not reasonably confident of.',
  'This is a data-capture task, not a dietary-advice one: never add commentary about whether the food is healthy.',
].join(' ');

const INSTRUCTION =
  'This is a photo of food and/or drink about to be or being consumed. Call record_food_items once, with one entry ' +
  'per distinct item (e.g. a plate with rice, dal, and a glass of water is three items). If nothing edible/drinkable ' +
  'is identifiable in the photo, still call it with an empty items array.';

const EXTRACTION_TOOL = {
  name: 'record_food_items',
  description:
    'Record every distinct food or drink item identified in a photo, with an estimated quantity and nutrition ' +
    'profile for the portion actually shown. Never fabricate a portion size that cannot be judged from the image - ' +
    'flag it with needs_quantity instead.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Food/drink name, e.g. "Steamed white rice" or "Orange juice".' },
            brand: { type: ['string', 'null'], description: 'Brand name if a legible package identifies one, else null.' },
            quantity_amount: {
              type: ['number', 'null'],
              description: 'Numeric portion amount (e.g. 1.5), or null if it cannot be confidently judged.',
            },
            quantity_unit: {
              type: ['string', 'null'],
              enum: ['g', 'ml', 'serving', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other', null],
              description: 'Unit for quantity_amount, or null.',
            },
            serving_size_grams: {
              type: ['number', 'null'],
              description: 'Approximate grams for one serving/piece of this item, when estimable, else null.',
            },
            ...nutrientToolProperties('the portion shown'),
            needs_quantity: {
              type: 'boolean',
              description: 'True when the portion size could not be confidently judged from the image.',
            },
            confidence: { type: 'number', description: '0-1 confidence in the identification (not the portion estimate).' },
          },
          required: ['name', 'needs_quantity', 'confidence'],
        },
      },
    },
    required: ['items'],
  },
};

function buildContent(document) {
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    const imageBlocks = document.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return [...imageBlocks, { type: 'text', text: INSTRUCTION }];
  }
  return null;
}

function readImageAsContent(filePath, mimeType) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  return [
    { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
    { type: 'text', text: INSTRUCTION },
  ];
}

// Provider-agnostic contract: extract(document, context) -> { items,
// warnings, rawModelOutput }, where context carries { filePath, mimeType }.
async function extract(document, context = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('Diet photo scanning requires ANTHROPIC_API_KEY to be set.');
  }

  let content = buildContent(document);
  if (!content && context.filePath && /^image\//.test(context.mimeType || '')) {
    content = readImageAsContent(context.filePath, context.mimeType);
  }
  if (!content) {
    return { items: [], warnings: ['No readable image content was found in this scan.'], rawModelOutput: null };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content }],
  });
  recordAiUsage(FEATURES.DIET_PHOTO, response);

  const warnings = [];
  if (response.stop_reason === 'max_tokens') {
    warnings.push('The model\'s response was truncated - some items may be missing.');
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { items: [], warnings: [...warnings, 'No structured extraction result was returned.'], rawModelOutput: response };
  }

  const rawItems = Array.isArray(toolUse.input?.items) ? toolUse.input.items : [];
  const items = rawItems
    .filter((item) => item && item.name)
    .map((item) => {
      const needsQuantity = Boolean(item.needs_quantity) || typeof item.quantity_amount !== 'number';
      const nutrients = {};
      for (const field of NUTRIENT_FIELDS) {
        nutrients[field] = needsQuantity ? null : (typeof item[field] === 'number' ? item[field] : null);
      }
      return {
        name: String(item.name),
        brand: item.brand || null,
        quantity_amount: needsQuantity ? null : item.quantity_amount,
        quantity_unit: needsQuantity ? null : item.quantity_unit || null,
        serving_size_grams: typeof item.serving_size_grams === 'number' ? item.serving_size_grams : null,
        ...nutrients,
        needs_quantity: needsQuantity,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
        needs_review: needsQuantity || typeof item.confidence !== 'number' || item.confidence < 0.75,
      };
    });

  return { items, warnings, rawModelOutput: toolUse.input };
}

module.exports = { name: 'claude', extract };
