const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const config = require('../config');

// Groups a confirmed lab result whose test name never matched anything in
// the Health Parameter Registry into an ad-hoc dashboard card label instead
// of letting it disappear (see routes/dashboard.js's /custom-cards, which
// this backs, and migration 015's comment for why). Every classification is
// cached in custom_parameter_groups, keyed by normalized test name, so a
// given test name is only ever classified once - by Claude when
// config.customCardProvider === 'claude' and a key is configured, else by
// the deterministic keyword heuristic below, which always succeeds with no
// network call at all (the default, and every CI/test/local-dev run).

function normalizeTestNameKey(rawTestName) {
  return String(rawTestName || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Checked in order; the first matching rule wins. Deliberately narrow
// (specific lab vocabulary, not generic English words) so an unrecognized
// test name falls through to DEFAULT_GROUP rather than being guessed at.
const HEURISTIC_RULES = [
  { pattern: /protein|albumin|globulin|a\/?g\s*ratio/i, label: 'Proteins', icon: '🧬' },
  { pattern: /vitamin|folate|\bb\s?12\b|\bd\s?3\b|25[\s-]*hydroxy/i, label: 'Vitamins & Nutrients', icon: '💊' },
  { pattern: /\biron\b|ferritin|tibc|transferrin/i, label: 'Iron Studies', icon: '🩸' },
  {
    pattern: /hormone|testosterone|estrogen|estradiol|cortisol|\bfsh\b|\blh\b|prolactin|progesterone/i,
    label: 'Hormones',
    icon: '⚗️',
  },
  { pattern: /tumou?r|\bantigen\b|\bpsa\b|\bcea\b|\bca[\s-]?\d/i, label: 'Tumor Markers', icon: '🔬' },
  { pattern: /allerg|\bige\b/i, label: 'Allergy & Immune', icon: '🤧' },
  { pattern: /coagul|\binr\b|\bptt\b|prothrombin|d-dimer/i, label: 'Coagulation', icon: '🩹' },
  { pattern: /electrolyte|sodium|potassium|chloride|bicarbonate/i, label: 'Electrolytes', icon: '🧂' },
  { pattern: /inflammat|\bcrp\b|\besr\b|sedimentation/i, label: 'Inflammation Markers', icon: '🔥' },
];
const DEFAULT_GROUP = { label: 'Other Results', icon: '🔬' };

function classifyHeuristically(testNameKey) {
  const rule = HEURISTIC_RULES.find((r) => r.pattern.test(testNameKey));
  return rule ? { label: rule.label, icon: rule.icon } : { ...DEFAULT_GROUP };
}

const GROUPING_TOOL = {
  name: 'group_test_names',
  description:
    'Assign every given lab/health test name to a short, patient-friendly group label (e.g. "Proteins", "Iron Studies", ' +
    '"Hormones") that could head a dashboard card, plus one representative emoji icon. Group clinically related tests ' +
    'together; use "Other Results" only when nothing more specific fits.',
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
          },
          required: ['test_name', 'group_label'],
        },
      },
    },
    required: ['groups'],
  },
};

async function classifyWithClaude(testNames) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system:
      'You are grouping lab test names into dashboard card categories for a personal health app. ' +
      'Never invent a diagnosis or clinical interpretation - only group by what kind of test it is.',
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
    result.set(key, { label, icon: String(entry.icon || '').trim() || DEFAULT_GROUP.icon });
  }
  return result;
}

// `rawTestNames` is every distinct raw_test_name of the user's confirmed,
// unmapped (health_parameter_id IS NULL), non-duplicate measurements.
// Returns Map<normalizedTestNameKey, { label, icon }> covering every one of
// them - never partial, so a caller building cards never silently drops a
// result for lack of a group.
async function groupTestNames(rawTestNames) {
  const keys = [...new Set(rawTestNames.map(normalizeTestNameKey))].filter(Boolean);
  const resultMap = new Map();
  if (keys.length === 0) return resultMap;

  const { rows: cached } = await pool.query(
    `SELECT test_name_key, group_label, icon FROM custom_parameter_groups WHERE test_name_key = ANY($1)`,
    [keys]
  );
  for (const row of cached) {
    resultMap.set(row.test_name_key, { label: row.group_label, icon: row.icon });
  }

  const missingKeys = keys.filter((k) => !resultMap.has(k));
  if (missingKeys.length === 0) return resultMap;

  let aiClassifications = null;
  if (config.customCardProvider === 'claude' && config.anthropicApiKey) {
    try {
      aiClassifications = await classifyWithClaude(missingKeys);
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
      `INSERT INTO custom_parameter_groups (test_name_key, group_label, icon, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (test_name_key) DO UPDATE SET test_name_key = EXCLUDED.test_name_key
       RETURNING test_name_key, group_label, icon`,
      [key, classification.label, classification.icon, source]
    );
    resultMap.set(rows[0].test_name_key, { label: rows[0].group_label, icon: rows[0].icon });
  }

  return resultMap;
}

module.exports = { groupTestNames, normalizeTestNameKey, classifyHeuristically };
