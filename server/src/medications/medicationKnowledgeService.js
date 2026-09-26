const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const config = require('../config');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { findKnowledgeEntry } = require('./medicationLinkingService');
const { normalizeLanguage, languageInstruction, DEFAULT_LANGUAGE } = require('../services/languageService');
const { SYSTEM_AUTHORITY, aiFallbackSource } = require('./citationSources');

// Medicine details "irrespective of tracking list": medicationKnowledgeBase.js
// is a small, hand-curated list (~20 chronic-disease medications with
// parameter-monitoring links) - a real medication outside it (an OTC ear
// drop, a topical, a less common brand) previously just showed nothing on
// Medication Detail. This adds an AI fallback (Claude, when configured) for
// exactly that case, cached in medication_knowledge_cache per (medication
// name, language) - migration 016 - so a given medication/language pair is
// only ever generated once. The curated knowledge base still wins whenever
// it matches (it's vetted, has parameter-monitoring links AI can't safely
// infer, and costs nothing to serve) - this only fills the gap behind it.
//
// Unlike customCardService's heuristic fallback, there is no safe
// keyword-based fallback for medical facts about an arbitrary drug name -
// getting it wrong is a real risk in a way a dashboard card *label* isn't.
// So with no AI provider configured, an uncurated medication simply
// returns null here, exactly like it always has - never a guess.

function normalizeNameKey(value) {
  return String(value || '').trim().toLowerCase();
}

function nameKeyFor(medication) {
  return normalizeNameKey(medication.generic_name || medication.name || medication.brand_name);
}

const KNOWLEDGE_TOOL = {
  name: 'describe_medication',
  description:
    'Describe a medication for a non-clinical reader: what it is/its drug class, what it is commonly used for, its ' +
    'active ingredient(s), common side effects, and important safety warnings. Only well-established, general facts - ' +
    'never dosing advice specific to one person, and never a fact you are not confident is accurate.',
  input_schema: {
    type: 'object',
    properties: {
      found: {
        type: 'boolean',
        description: 'false if this is not a real/recognizable medication name - then omit every other field.',
      },
      category: { type: 'string', description: 'Short drug class, e.g. "Antihypertensive (ACE inhibitor)".' },
      usage: { type: 'string', description: 'One to two plain-language sentences on what it is commonly used for.' },
      active_ingredient: { type: 'string', description: 'Active ingredient(s), as commonly formulated.' },
      common_side_effects: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['found'],
  },
};

async function describeWithClaude(medication, language) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const label = [medication.name, medication.generic_name, medication.brand_name].filter(Boolean).join(' / ');
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 700,
    system:
      'You describe a medication’s general, well-established facts for a patient-facing health app, for a reader with ' +
      'no medical background. Never give dosing advice for a specific person, never diagnose, and never state a fact ' +
      `you are not confident is accurate for this exact medication - call describe_medication with found:false instead ` +
      `of guessing at an unfamiliar or ambiguous name.${languageInstruction(language)}`,
    messages: [{ role: 'user', content: `Describe this medication: ${label}` }],
    tools: [KNOWLEDGE_TOOL],
    tool_choice: { type: 'tool', name: 'describe_medication' },
  });
  recordAiUsage(FEATURES.MEDICATION_KNOWLEDGE, response);

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const input = toolUse?.input;
  if (!input || input.found !== true) return null;

  return {
    category: String(input.category || '').trim() || null,
    usage: String(input.usage || '').trim() || null,
    activeIngredient: String(input.active_ingredient || '').trim() || null,
    commonSideEffects: Array.isArray(input.common_side_effects) ? input.common_side_effects.filter(Boolean) : [],
    warnings: Array.isArray(input.warnings) ? input.warnings.filter(Boolean) : [],
  };
}

// Returns the same shape routes/medications.js's knowledgeSummary/chat's
// get_medication_detail already expose ({ category, usage, typicalDailyDose,
// activeIngredient, commonSideEffects, warnings }), or null when nothing is
// known (curated or AI) - never a guess. `language` is the user's
// preferred_language (see languageService.js).
async function getMedicationKnowledge(medication, language = DEFAULT_LANGUAGE) {
  const curated = findKnowledgeEntry(medication);
  if (curated) {
    const system = curated.system || 'allopathic';
    // A curated entry can override the default per-system authority (e.g.
    // pointing a homeopathic remedy at NCCIH's evidence page instead of
    // CCRH's homepage) - see medicationKnowledgeBase.js and citationSources.js.
    const authority = curated.sourceUrl ? { name: curated.sourceName, url: curated.sourceUrl } : SYSTEM_AUTHORITY[system];
    return {
      system,
      category: curated.category,
      usage: curated.usage,
      typicalDailyDose: curated.typicalDailyDose,
      activeIngredient: curated.activeIngredient,
      commonSideEffects: curated.commonSideEffects,
      warnings: curated.warnings,
      sourceName: authority?.name || null,
      sourceUrl: authority?.url || null,
      sourceIsExactCitation: true,
    };
  }

  const nameKey = nameKeyFor(medication);
  if (!nameKey) return null;
  const lang = normalizeLanguage(language);
  // An AI-described medication has no single traceable citation the way a
  // curated entry does - this links to the relevant system's official body
  // to look the medication up independently, never claiming it's "the"
  // source of the generated text (see sourceIsExactCitation below).
  const fallbackAuthority = aiFallbackSource(medication.medicine_system);

  const { rows: cached } = await pool.query(
    `SELECT * FROM medication_knowledge_cache WHERE name_key = $1 AND language = $2`,
    [nameKey, lang]
  );
  if (cached.length > 0) {
    const row = cached[0];
    return {
      system: medication.medicine_system || 'allopathic',
      category: row.category,
      usage: row.usage,
      typicalDailyDose: null,
      activeIngredient: row.active_ingredient,
      commonSideEffects: row.common_side_effects,
      warnings: row.warnings,
      sourceName: fallbackAuthority.name,
      sourceUrl: fallbackAuthority.url,
      sourceIsExactCitation: false,
    };
  }

  if (config.medicationKnowledgeProvider !== 'claude' || !config.anthropicApiKey) return null;

  let described;
  try {
    described = await describeWithClaude(medication, lang);
  } catch (err) {
    described = null;
  }
  if (!described) return null;

  const { rows } = await pool.query(
    `INSERT INTO medication_knowledge_cache
       (name_key, language, category, usage, active_ingredient, common_side_effects, warnings)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name_key, language) DO UPDATE SET name_key = EXCLUDED.name_key
     RETURNING *`,
    [nameKey, lang, described.category, described.usage, described.activeIngredient, described.commonSideEffects, described.warnings]
  );
  const row = rows[0];
  return {
    system: medication.medicine_system || 'allopathic',
    category: row.category,
    usage: row.usage,
    typicalDailyDose: null,
    activeIngredient: row.active_ingredient,
    commonSideEffects: row.common_side_effects,
    warnings: row.warnings,
    sourceName: fallbackAuthority.name,
    sourceUrl: fallbackAuthority.url,
    sourceIsExactCitation: false,
  };
}

module.exports = { getMedicationKnowledge, normalizeNameKey };
