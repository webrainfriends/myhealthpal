const { getAiClient } = require('../../ai/privacyGateway');
const config = require('../../config');
const { recordAiUsage, FEATURES } = require('../../services/aiUsageService');

// Reads a diet/meal-plan document (PDF, DOCX, XLSX, CSV, or a photo of a
// written plan) into day/meal/dish entries - the diet-schedule analog of
// claudeProvider.js's lab-report extraction. buildContent() below is a
// deliberate copy of that file's text/table/image branching (including its
// context.fileBuffer vision fallback for a photo) rather than a shared
// helper: the two tools' instructions and output schemas are unrelated, and
// duplicating ~20 lines of branching keeps each provider readable on its
// own, the same tradeoff dietPhotoProvider.js already makes for its own
// image-only version of the same pattern.

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

const SYSTEM_PROMPT = [
  'You are a precise data-extraction engine for personal diet/meal-plan documents.',
  'Extract only what is explicitly present in the document.',
  'Never invent, infer, or guess a day, meal, or dish that is not written or printed in the source.',
  'If a value is unclear or you are not confident you read it correctly, still report it but lower its confidence score.',
  'This is a data-capture task, not a meal-planning one: never add, substitute, or "complete" a day or meal the source does not actually show.',
].join(' ');

function documentInstruction(requestedDurationDays) {
  return (
    'Extract every day/meal/dish entry from this diet or meal-plan document by calling record_diet_schedule once. ' +
    `The person requested a ${requestedDurationDays}-day schedule, but you must still only report entries that are ` +
    'actually legible in the document - never invent extra days or meals just to reach that count, and never drop a ' +
    'day the document does show even if it goes beyond that count. For each entry, report the day number as it ' +
    'appears (Day 1, Monday = day 1, etc. - number sequentially from the first day shown if no explicit numbering is ' +
    'given), the meal type it is written under (map free-text meal headers like "morning"/"AM" to breakfast, ' +
    '"evening snack" to snack, "night"/"PM" to dinner or supper as best fits), and the dish/food name exactly as ' +
    'written. If the document states an overall duration (e.g. "7-day meal plan"), report it in detected_duration_days. ' +
    'If the document is unreadable or contains no schedule content, still call the tool with an empty entries array.'
  );
}

const EXTRACTION_TOOL = {
  name: 'record_diet_schedule',
  description: 'Record every day/meal/dish entry found in a diet or meal-plan document, plus the detected overall duration if stated.',
  input_schema: {
    type: 'object',
    properties: {
      detected_duration_days: {
        type: ['number', 'null'],
        description: 'The overall schedule duration in days as stated in the document (e.g. 7 for "7-day meal plan"), or null if not stated.',
      },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            day_number: { type: 'number', description: 'Which day of the schedule this entry belongs to, starting at 1.' },
            meal_type: { type: 'string', enum: MEAL_TYPES, description: 'Which meal this entry is written under.' },
            dish_name: { type: 'string', description: 'The dish/food name exactly as written in the source.' },
            raw_text: { type: ['string', 'null'], description: 'The original line/cell this was read from, if usefully different from dish_name, else null.' },
            confidence: { type: 'number', description: '0-1 confidence that this was read correctly from the source.' },
          },
          required: ['day_number', 'meal_type', 'dish_name', 'confidence'],
        },
      },
    },
    required: ['entries'],
  },
};

function serializeTables(tables) {
  return tables.map((rows) => rows.map((row) => row.join(', ')).join('\n')).join('\n\n---\n\n');
}

// Copied from claudeProvider.js's buildContent (see file comment above for
// why this isn't shared): text_native -> plain text, structured_table ->
// serialized rows, image_scanned -> every pre-rendered page image
// (multi-page PDFs) or, failing that, the raw uploaded file buffer itself
// when it's a single photo (context.fileBuffer) - the same vision path
// already proven to work for lab report photos, unmodified here.
function buildContent(document, context, instruction) {
  if (document.contentKind === 'text_native' && document.text) {
    return [{ type: 'text', text: `${instruction}\n\n${document.text}` }];
  }
  if (document.contentKind === 'structured_table' && document.tables) {
    return [{ type: 'text', text: `${instruction}\n\n${serializeTables(document.tables)}` }];
  }
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    const imageBlocks = document.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return [...imageBlocks, { type: 'text', text: instruction }];
  }
  if (document.contentKind === 'image_scanned' && context.fileBuffer && /^image\//.test(context.mimeType || '')) {
    const base64 = context.fileBuffer.toString('base64');
    return [
      { type: 'image', source: { type: 'base64', media_type: context.mimeType, data: base64 } },
      { type: 'text', text: instruction },
    ];
  }
  return null;
}

// Provider contract: extract(document, context) -> { entries, detectedDurationDays,
// warnings, rawModelOutput }. context carries userId, fileBuffer, mimeType,
// and requestedDurationDays (the duration the person picked before uploading).
async function extract(document, context = {}) {
  if (!config.anthropicApiKey) {
    throw new Error('Diet schedule import requires ANTHROPIC_API_KEY to be set.');
  }

  const instruction = documentInstruction(context.requestedDurationDays || 7);
  const content = buildContent(document, context, instruction);
  if (!content) {
    return {
      entries: [],
      detectedDurationDays: null,
      warnings: ['No supported content to extract from this document (e.g. a scanned PDF page that rendered no images).'],
      rawModelOutput: null,
    };
  }

  const client = await getAiClient({ subjectUserId: context.userId, purpose: 'diet_schedule_import' });
  const response = await client.messages.streamFinal({
    model: config.anthropicModel,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
    messages: [{ role: 'user', content }],
  });
  recordAiUsage(FEATURES.DIET_SCHEDULE_IMPORT, response);

  const warnings = [];
  if (response.stop_reason === 'max_tokens') {
    warnings.push('The AI output was truncated (hit the token limit) - some entries near the end of this document may be missing.');
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return { entries: [], detectedDurationDays: null, warnings: [...warnings, 'The AI did not return a structured result.'], rawModelOutput: response };
  }

  const rawEntries = Array.isArray(toolUse.input?.entries) ? toolUse.input.entries : [];
  const entries = rawEntries
    .filter((e) => e && Number.isFinite(e.day_number) && MEAL_TYPES.includes(e.meal_type) && e.dish_name)
    .map((e) => ({
      dayNumber: Math.max(1, Math.round(e.day_number)),
      mealType: e.meal_type,
      dishName: String(e.dish_name).trim(),
      rawText: e.raw_text || null,
      confidence: typeof e.confidence === 'number' ? e.confidence : 0.7,
      needsReview: typeof e.confidence !== 'number' || e.confidence < 0.75,
    }));

  const detectedDurationDays = typeof toolUse.input?.detected_duration_days === 'number'
    ? toolUse.input.detected_duration_days
    : null;

  return { entries, detectedDurationDays, warnings, rawModelOutput: toolUse.input };
}

module.exports = { name: 'diet_schedule', extract, buildContent, MEAL_TYPES };
