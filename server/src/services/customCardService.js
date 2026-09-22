const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const config = require('../config');
const { normalizeLanguage, languageInstruction, DEFAULT_LANGUAGE } = require('./languageService');

// Groups a confirmed lab result whose test name never matched anything in
// the Health Parameter Registry into an ad-hoc dashboard card label (plus a
// one-line description of what the group is for - test report analysis
// that isn't limited to the app's fixed, pre-mapped test list) instead of
// letting it disappear (see routes/dashboard.js's /custom-cards, which this
// backs, and migration 015's comment for why). Every classification is
// cached in custom_parameter_groups, keyed by (normalized test name,
// language) - see migration 016 - so a given (test name, language) pair is
// only ever classified once: by Claude when config.customCardProvider ===
// 'claude' and a key is configured, else by the deterministic keyword
// heuristic below, which always succeeds with no network call at all (the
// default, and every CI/test/local-dev run). The heuristic is English-only
// - a non-English request with no AI provider configured still gets a
// correct grouping, just in English, rather than a broken/untranslated app.

function normalizeTestNameKey(rawTestName) {
  return String(rawTestName || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Checked in order; the first matching rule wins. Deliberately narrow
// (specific lab vocabulary, not generic English words) so an unrecognized
// test name falls through to DEFAULT_GROUP rather than being guessed at.
const HEURISTIC_RULES = [
  {
    pattern: /protein|albumin|globulin|a\/?g\s*ratio/i,
    label: 'Proteins',
    icon: '🧬',
    description: 'Blood protein levels, including albumin, globulin, and their ratio.',
  },
  {
    pattern: /vitamin|folate|\bb\s?12\b|\bd\s?3\b|25[\s-]*hydroxy/i,
    label: 'Vitamins & Nutrients',
    icon: '💊',
    description: 'Vitamin and nutrient levels in the blood.',
  },
  {
    pattern: /\biron\b|ferritin|tibc|transferrin/i,
    label: 'Iron Studies',
    icon: '🩸',
    description: 'Iron levels and how well the body is storing/transporting it.',
  },
  {
    pattern: /hormone|testosterone|estrogen|estradiol|cortisol|\bfsh\b|\blh\b|prolactin|progesterone/i,
    label: 'Hormones',
    icon: '⚗️',
    description: 'Hormone levels in the blood.',
  },
  {
    pattern: /tumou?r|\bantigen\b|\bpsa\b|\bcea\b|\bca[\s-]?\d/i,
    label: 'Tumor Markers',
    icon: '🔬',
    description: 'Substances sometimes elevated with certain conditions, used alongside other tests, not on their own.',
  },
  {
    pattern: /allerg|\bige\b/i,
    label: 'Allergy & Immune',
    icon: '🤧',
    description: 'Markers related to allergic response and immune activity.',
  },
  {
    pattern: /coagul|\binr\b|\bptt\b|prothrombin|d-dimer/i,
    label: 'Coagulation',
    icon: '🩹',
    description: 'How well and how quickly the blood clots.',
  },
  {
    pattern: /electrolyte|sodium|potassium|chloride|bicarbonate/i,
    label: 'Electrolytes',
    icon: '🧂',
    description: 'Salts and minerals that help regulate fluid balance, nerves, and muscles.',
  },
  {
    pattern: /inflammat|\bcrp\b|\besr\b|sedimentation/i,
    label: 'Inflammation Markers',
    icon: '🔥',
    description: 'General markers of inflammation in the body.',
  },
];
const DEFAULT_GROUP = { label: 'Other Results', icon: '🔬', description: 'Results that don’t fit a more specific group yet.' };

function classifyHeuristically(testNameKey) {
  const rule = HEURISTIC_RULES.find((r) => r.pattern.test(testNameKey));
  const match = rule || DEFAULT_GROUP;
  return { label: match.label, icon: match.icon, description: match.description };
}

const GROUPING_TOOL = {
  name: 'group_test_names',
  description:
    'Assign every given lab/health test name to a short, patient-friendly group label (e.g. "Proteins", "Iron Studies", ' +
    '"Hormones") that could head a dashboard card, one representative emoji icon, and a short (one sentence) plain-' +
    'language description of what that group of tests is for. Group clinically related tests together; use ' +
    '"Other Results" only when nothing more specific fits.',
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            test_name: { type: 'string', description: 'Exactly one of the input test names, unchanged.' },
            group_label: { type: 'string', description: 'Short (1-4 word) patient-friendly group/card label.' },
            icon: { type: 'string', description: 'One representative emoji for this group.' },
            description: { type: 'string', description: 'One plain-language sentence on what this group of tests is for.' },
          },
          required: ['test_name', 'group_label'],
        },
      },
    },
    required: ['groups'],
  },
};

async function classifyWithClaude(testNames, language) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system:
      'You are grouping lab test names into dashboard card categories for a personal health app, for a reader with no ' +
      'medical background. Never invent a diagnosis or clinical interpretation - only group by what kind of test it is, ' +
      `and explain plainly what each group is generally for.${languageInstruction(language)}`,
    messages: [
      {
        role: 'user',
        content: `Group these test names by calling group_test_names once:\n${testNames.map((n) => `- ${n}`).join('\n')}`,
      },
    ],
    tools: [GROUPING_TOOL],
    tool_choice: { type: 'tool', name: 'group_test_names' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const groups = toolUse?.input?.groups;
  if (!Array.isArray(groups)) return new Map();

  const result = new Map();
  for (const entry of groups) {
    const key = normalizeTestNameKey(entry.test_name);
    const label = String(entry.group_label || '').trim();
    if (!key || !label) continue;
    result.set(key, {
      label,
      icon: String(entry.icon || '').trim() || DEFAULT_GROUP.icon,
      description: String(entry.description || '').trim() || null,
    });
  }
  return result;
}

// `rawTestNames` is every distinct raw_test_name of the user's confirmed,
// unmapped (health_parameter_id IS NULL), non-duplicate measurements.
// `language` is the user's preferred_language (see languageService.js) -
// defaults to English. Returns Map<normalizedTestNameKey, { label, icon,
// description }> covering every one of them - never partial, so a caller
// building cards never silently drops a result for lack of a group.
async function groupTestNames(rawTestNames, language = DEFAULT_LANGUAGE) {
  const lang = normalizeLanguage(language);
  const keys = [...new Set(rawTestNames.map(normalizeTestNameKey))].filter(Boolean);
  const resultMap = new Map();
  if (keys.length === 0) return resultMap;

  const { rows: cached } = await pool.query(
    `SELECT test_name_key, group_label, icon, description FROM custom_parameter_groups
     WHERE test_name_key = ANY($1) AND language = $2`,
    [keys, lang]
  );
  for (const row of cached) {
    resultMap.set(row.test_name_key, { label: row.group_label, icon: row.icon, description: row.description });
  }

  const missingKeys = keys.filter((k) => !resultMap.has(k));
  if (missingKeys.length === 0) return resultMap;

  let aiClassifications = null;
  if (config.customCardProvider === 'claude' && config.anthropicApiKey) {
    try {
      aiClassifications = await classifyWithClaude(missingKeys, lang);
    } catch (err) {
      aiClassifications = null;
    }
  }

  for (const key of missingKeys) {
    const fromAi = aiClassifications?.get(key);
    const classification = fromAi || classifyHeuristically(key);
    const source = fromAi ? 'ai' : 'heuristic';
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await pool.query(
      `INSERT INTO custom_parameter_groups (test_name_key, group_label, icon, description, source, language)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (test_name_key, language) DO UPDATE SET test_name_key = EXCLUDED.test_name_key
       RETURNING test_name_key, group_label, icon, description`,
      [key, classification.label, classification.icon, classification.description || null, source, lang]
    );
    resultMap.set(rows[0].test_name_key, {
      label: rows[0].group_label,
      icon: rows[0].icon,
      description: rows[0].description,
    });
  }

  return resultMap;
}

module.exports = { groupTestNames, normalizeTestNameKey, classifyHeuristically };
