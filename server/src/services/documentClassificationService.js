const { getAdapter } = require('../adapters');
const { withTimeout } = require('../lib/withTimeout');
const { logError } = require('../lib/safeLog');
const config = require('../config');
const privacyGateway = require('../ai/privacyGateway');
const { recordAiUsage, FEATURES } = require('./aiUsageService');

// Decides what an upload is - a lab result, an insurance document, food, or
// a diet schedule - so one Upload screen can route any file to the right
// pipeline. Cheap deterministic keyword scoring runs first (no AI call, no
// data leaves the server) and settles the clear cases; only an ambiguous
// document, or a photo with no text to score, goes to the AI reader, and only
// when the person has consented to AI document processing. When nothing is
// certain the upload falls back to the lab-report pipeline - exactly what
// every upload did before classification existed - and the response says so,
// so the person can re-upload with an explicit type.

const CATEGORIES = ['lab_report', 'insurance', 'food', 'diet_schedule'];
const CATEGORY_LABELS = {
  lab_report: 'Lab result',
  insurance: 'Insurance policy',
  food: 'Food',
  diet_schedule: 'Diet schedule',
};

// Formats that only ever carry health-tracker data (Apple Health exports):
// never worth classifying, always the report pipeline's activity import.
const TRACKER_EXPORT_EXTENSIONS = new Set(Object.keys(config.healthExportExtensions));

const AI_MIN_CONFIDENCE = 0.55;
const HEURISTIC_MIN_SCORE = 4;
const HEURISTIC_MIN_MARGIN = 2;
const SAMPLE_CHARS = 6000;

// [pattern, weight]. A pattern counts once however often it appears - the
// score is how many distinct signals the document shows, not its length.
const SIGNALS = {
  insurance: [
    [/policy\s*(no\.?|number|#)/i, 2],
    [/sum\s+insured/i, 3],
    [/\bpremium\b/i, 1],
    [/\binsurer\b|insurance\s+(company|co\b|limited|ltd)/i, 2],
    [/\bexclusions?\b/i, 1],
    [/co-?pay(ment)?/i, 1],
    [/waiting\s+period/i, 2],
    [/pre-?existing/i, 2],
    [/cashless/i, 2],
    [/policy\s*holder|proposer|insured\s+person/i, 2],
    [/\bTPA\b|third[\s-]party\s+administrator/i, 2],
    [/\brenewal\b/i, 1],
    [/irdai?\b/i, 2],
    [/deductible/i, 1],
    [/hospitali[sz]ation/i, 1],
    [/\bclaims?\b/i, 1],
    [/\brider\b|add-?on cover/i, 1],
    [/(health|medical|mediclaim)\s+(insurance|policy|plan)/i, 2],
  ],
  lab_report: [
    [/reference\s+(range|interval|value)|bio(logical)?\.?\s+ref/i, 3],
    [/\b(mg\/dl|g\/dl|mmol\/l|iu\/l|u\/l|ng\/ml|pg\/ml|miu\/l|[µu]iu\/ml|lakhs?\/|cells\/|fl\b|mmhg)\b/i, 2],
    [/specimen|sample\s+(type|collected|received)|collected\s+on|reported\s+on/i, 2],
    [/hemoglobin|haemoglobin|creatinine|cholesterol|hba1c|\btsh\b|bilirubin|platelet|triglyceride|sgpt|sgot|\balt\b|\bast\b/i, 3],
    [/patholog|laborator(y|ies)|diagnostics?\b|lab\s+report|test\s+report/i, 2],
    [/\bglucose\b|urea|uric\s+acid|\bvitamin\b/i, 1],
    [/radiolog|impression:|findings:|\bmri\b|\bct\s+scan\b|x-?ray/i, 2],
    [/\bflag\b|\bH\b\s*\/\s*\bL\b|\(h\)|\(l\)/i, 1],
  ],
  diet_schedule: [
    [/meal\s*(plan|chart|schedule)|diet\s*(plan|chart|schedule)|weekly\s+menu/i, 4],
    [/\b(breakfast|lunch|dinner|supper)\b/i, 1],
    [/\b(mid[\s-]?morning|evening\s+snack|snacks?)\b/i, 1],
    [/\b(mon|tues?|wednes|thurs?|fri|satur|sun)(day)?\b/i, 1],
    [/\b(early\s+morning|bed\s*time|pre-?workout|post-?workout)\b/i, 1],
  ],
  food: [
    [/nutrition(al)?\s+(facts|information|value|label)/i, 4],
    [/\b(calories|kcal)\b/i, 2],
    [/ingredients?\s*:/i, 2],
    [/serving\s+size|per\s+serving|per\s+100\s*g/i, 3],
    [/\b(protein|carbohydrates?|total\s+fat|saturated\s+fat|sodium|dietary\s+fib(er|re))\b/i, 1],
    [/\bmenu\b|\bbill\b|\border\s+(no|id)\b|\bqty\b/i, 1],
  ],
};

function serializeTables(tables) {
  return tables.map((rows) => rows.map((row) => row.join(', ')).join('\n')).join('\n\n');
}

function documentText(document) {
  if (!document) return '';
  if (document.contentKind === 'text_native' && document.text) return document.text;
  if (document.contentKind === 'structured_table' && document.tables) return serializeTables(document.tables);
  return '';
}

// Distinct-signal score per category over the text (plus the filename,
// which often says "policy" / "diet chart" / "report" outright). Exported
// for tests.
function scoreText(text, filename = '') {
  const haystack = `${String(filename).replace(/[_-]+/g, ' ')}\n${String(text || '').slice(0, 60000)}`;
  const scores = { lab_report: 0, insurance: 0, food: 0, diet_schedule: 0 };
  for (const [category, signals] of Object.entries(SIGNALS)) {
    for (const [pattern, weight] of signals) {
      if (new RegExp(pattern.source, pattern.flags.replace('g', '')).test(haystack)) scores[category] += weight;
    }
  }
  // A day-by-day structure ("Day 1 ... Day 7") is what separates a diet
  // schedule from a single day's food log or a nutrition label.
  const dayMarkers = new Set((haystack.match(/\bday\s*[-:]?\s*([1-9]\d?)\b/gi) || []).map((m) => m.toLowerCase().replace(/\D/g, '')));
  if (dayMarkers.size >= 3) scores.diet_schedule += 4;
  else if (dayMarkers.size === 2) scores.diet_schedule += 1;
  const weekdays = new Set((haystack.match(/\b(mon|tues?|wednes|thurs?|fri|satur|sun)day\b/gi) || []).map((m) => m.toLowerCase()));
  if (weekdays.size >= 4) scores.diet_schedule += 3;
  // Meal words alone (a lab report can mention "fasting/after lunch") are
  // weak; a schedule needs the meal words *and* a day structure.
  if (dayMarkers.size < 2 && weekdays.size < 3 && !/(meal|diet)\s*(plan|chart|schedule)/i.test(haystack)) {
    scores.diet_schedule = Math.min(scores.diet_schedule, 2);
  }
  // Food-label words inside a schedule or lab document don't make it food.
  if (scores.diet_schedule >= HEURISTIC_MIN_SCORE || scores.lab_report >= HEURISTIC_MIN_SCORE || scores.insurance >= HEURISTIC_MIN_SCORE) {
    scores.food = Math.floor(scores.food / 2);
  }
  return scores;
}

// A confident deterministic call, or null to let the AI (or the default)
// decide. Exported for tests.
function heuristicDecision(text, filename) {
  const scores = scoreText(text, filename);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (top[1] >= HEURISTIC_MIN_SCORE && top[1] - second[1] >= HEURISTIC_MIN_MARGIN) {
    const confidence = Math.min(0.95, 0.7 + (top[1] - second[1]) * 0.03);
    return { category: top[0], confidence, scores, method: 'heuristic', reason: 'The wording matches this kind of document.' };
  }
  // A weaker hint, used only when nothing else can settle it: clearly ahead
  // of the lab-report score (the default), and never for food, whose words
  // ("protein", "calories") show up in plenty of other documents.
  const weak = top[0] !== 'food' && top[1] >= 3 && top[1] - scores.lab_report >= 2 ? top[0] : null;
  return { category: null, scores, weak };
}

const CLASSIFY_TOOL = {
  name: 'classify_document',
  description: 'Say what kind of document or photo this is.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...CATEGORIES, 'other'],
        description:
          'lab_report: a blood/urine/pathology test result, an imaging or radiology report, or a health-tracker or glucose-meter data export. ' +
          'insurance: a health-insurance policy, policy schedule, insurance card, premium notice, or coverage/benefit document. ' +
          'food: a photo of a meal, dish, packaged food or nutrition label, or a food bill, to be logged as something eaten. ' +
          'diet_schedule: a multi-day meal plan or diet chart that lists meals day by day. ' +
          'other: anything else (including prescriptions and unrelated documents).',
      },
      confidence: { type: 'number', description: '0-1 confidence in the category.' },
      reason: { type: 'string', description: 'One short sentence naming the visible evidence.' },
    },
    required: ['category', 'confidence', 'reason'],
  },
};

const CLASSIFY_SYSTEM =
  'You classify uploaded personal health documents so they can be filed correctly. ' +
  'Look only at what is visible or written. Do not extract any personal details and do not include names, numbers or other personal data in your reason.';

function buildContent(document, context, text) {
  const instruction = `Classify this upload (filename: ${context.filename || 'unknown'}) by calling classify_document once.`;
  if (text) return [{ type: 'text', text: `${instruction}\n\n${text.slice(0, SAMPLE_CHARS)}` }];
  if (document.contentKind === 'image_scanned' && Array.isArray(document.images) && document.images.length > 0) {
    // The first pages are enough to tell what a document is.
    const blocks = document.images.slice(0, 2).map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    return [...blocks, { type: 'text', text: instruction }];
  }
  if (document.contentKind === 'image_scanned' && context.buffer && /^image\//.test(context.mimeType || '')) {
    return [
      { type: 'image', source: { type: 'base64', media_type: context.mimeType, data: context.buffer.toString('base64') } },
      { type: 'text', text: instruction },
    ];
  }
  return null;
}

async function classifyWithAi(document, context, text) {
  const content = buildContent(document, context, text);
  if (!content) return null;
  const client = await privacyGateway.getAiClient({ subjectUserId: context.userId, purpose: 'document_classification' });
  const response = await client.messages.streamFinal({
    model: config.anthropicModel,
    max_tokens: 300,
    system: CLASSIFY_SYSTEM,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
    messages: [{ role: 'user', content }],
  });
  recordAiUsage(FEATURES.DOCUMENT_CLASSIFICATION, response);
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const input = toolUse?.input;
  if (!input || typeof input.category !== 'string') return null;
  const confidence = typeof input.confidence === 'number' ? Math.min(1, Math.max(0, input.confidence)) : 0.5;
  return {
    category: CATEGORIES.includes(input.category) ? input.category : 'lab_report',
    isOther: !CATEGORIES.includes(input.category),
    confidence,
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 200) : null,
  };
}

const DEFAULT_DECISION = { category: 'lab_report', confidence: 0.3, method: 'default' };

// { category, confidence, method: 'heuristic' | 'ai' | 'default', reason }.
// Never throws: any failure to read or classify falls back to the lab-report
// pipeline (its own errors then surface on the report as before).
async function classifyUpload({ buffer, extension, mimeType, filename, userId }) {
  if (TRACKER_EXPORT_EXTENSIONS.has(extension)) {
    return { ...DEFAULT_DECISION, confidence: 0.9, reason: 'Health-app export.' };
  }
  const adapter = getAdapter(extension);
  if (!adapter) return { ...DEFAULT_DECISION, reason: 'Unrecognised format.' };

  let document;
  try {
    document = await withTimeout(adapter.extract(buffer), config.security.parserTimeoutMs, 'Reading the document');
  } catch (err) {
    logError('Document classification could not read the upload', err);
    return { ...DEFAULT_DECISION, reason: 'The document could not be read to identify it.' };
  }

  const text = documentText(document);
  const heuristic = heuristicDecision(text, filename);
  if (heuristic.category) return heuristic;

  const aiAllowed =
    Boolean(config.anthropicApiKey) && (await privacyGateway.isAllowed({ subjectUserId: userId, purpose: 'document_classification' }).catch(() => false));
  if (aiAllowed) {
    try {
      const ai = await classifyWithAi(document, { userId, filename, mimeType, buffer }, text);
      if (ai && ai.confidence >= AI_MIN_CONFIDENCE && !ai.isOther) {
        return { category: ai.category, confidence: ai.confidence, method: 'ai', reason: ai.reason };
      }
      if (ai) {
        return { ...DEFAULT_DECISION, confidence: ai.confidence, reason: ai.reason || 'Not sure what this document is.' };
      }
    } catch (err) {
      logError('AI document classification failed', err);
    }
  }

  // No AI (no key or no consent) or it failed: a weak deterministic hint
  // still beats nothing, but only for a document with real text to go on.
  if (heuristic.weak && heuristic.weak !== 'lab_report') {
    return { category: heuristic.weak, confidence: 0.5, method: 'heuristic', reason: 'The wording partly matches this kind of document.' };
  }
  return { ...DEFAULT_DECISION, reason: text ? 'Treated as a lab result.' : 'A photo could not be identified without AI document reading.' };
}

module.exports = { classifyUpload, scoreText, heuristicDecision, documentText, CATEGORIES, CATEGORY_LABELS };
