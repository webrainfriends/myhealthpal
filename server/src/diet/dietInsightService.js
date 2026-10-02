const { getAiClient, isAllowed } = require('../ai/privacyGateway');
const pool = require('../db/pool');
const config = require('../config');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { findKnowledgeEntry } = require('../medications/medicationLinkingService');
const { fetchDietaryProfile, filterAllowed, joinList, describeProfileForPrompt } = require('./dietaryProfile');

// Foods named in tips. `requires` / `keywords` let the person's saved
// diet type and allergies filter them (see dietaryProfile.js) so a vegan or
// lactose-intolerant user is never pointed at foods they don't eat.
const FIBER_SOURCES = [
  { text: 'vegetables', keywords: 'vegetable' },
  { text: 'fruit', keywords: 'fruit' },
  { text: 'whole grains', keywords: 'wheat gluten grain oats' },
  { text: 'legumes', keywords: 'legume lentil chickpea bean pea' },
  { text: 'nuts and seeds', keywords: 'nut seed almond' },
];
const IRON_SOURCES = [
  { text: 'leafy greens', keywords: 'spinach greens' },
  { text: 'legumes', keywords: 'legume lentil chickpea bean pea' },
  { text: 'tofu and tempeh', keywords: 'soy tofu tempeh' },
  { text: 'pumpkin and sesame seeds', keywords: 'seed sesame' },
  { text: 'lean red meat', requires: 'meat', keywords: 'meat beef lamb' },
  { text: 'fish', requires: 'meat', keywords: 'fish seafood' },
];
const CHOLESTEROL_CONTRIBUTORS = [
  { text: 'organ meats', requires: 'meat', keywords: 'meat' },
  { text: 'egg yolks', requires: 'animal', keywords: 'egg' },
  { text: 'full-fat dairy', requires: 'animal', keywords: 'dairy milk cheese butter cream' },
  { text: 'fried food', keywords: 'fried' },
];
const GOUT_PURINE_FOODS = [
  { text: 'red meat', requires: 'meat', keywords: 'meat' },
  { text: 'organ meat', requires: 'meat', keywords: 'meat' },
  { text: 'alcohol', keywords: 'alcohol' },
];
const IRON_SPACING_FOODS = [
  { text: 'dairy', requires: 'animal', keywords: 'dairy milk cheese' },
  { text: 'tea', keywords: 'tea' },
  { text: 'coffee', keywords: 'coffee' },
];

// General-population dietary guideline defaults (not personalized, not a
// clinical prescription) used only to decide whether a pattern is worth
// flagging - the same spirit as insightRules.js's fixed 15%/30% thresholds:
// simple, explainable constants rather than per-user tuning that doesn't
// exist yet.
const SODIUM_DAILY_LIMIT_MG = 2300; // general upper limit (AHA/FDA)
const SUGAR_DAILY_LIMIT_G = 50; // WHO upper-bound guideline
const FIBER_DAILY_TARGET_G = 25;
const IRON_DAILY_TARGET_MG = 18; // FDA Nutrition Facts label Daily Value (unisex reference)
const CHOLESTEROL_DAILY_LIMIT_MG = 300; // FDA Nutrition Facts label Daily Value
const LATE_NIGHT_ENTRY_THRESHOLD = 3; // within the window
const SAFETY_TAIL =
  ' This is an automated observation based on your logged food and drink, not medical or dietary advice - talk to a healthcare professional or dietitian before making a significant change.';

// Every nutrient a food_entries row can carry - kept as one list (mirroring
// routes/diet.js's NUTRIENT_FIELDS) so averaging/summing them in
// computeMetrics is a loop, not 13 repeated lines, and so adding another
// nutrient column later only means updating it in one place per file.
const NUTRIENT_FIELDS = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'sugar_g',
  'sodium_mg', 'cholesterol_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'vitamin_d_mcg',
];

// Diet-relevant lab parameters, mapped to the same "consideration key" a
// matching active medication's category can also produce (see
// CATEGORY_CONSIDERATIONS below) so a lab flag and a medication pointing at
// the same underlying concern merge into one tip instead of two.
const LAB_CODE_CONSIDERATIONS = {
  glucose_fasting: { key: 'diabetes', label: 'blood sugar' },
  glucose_post_prandial: { key: 'diabetes', label: 'blood sugar' },
  hba1c: { key: 'diabetes', label: 'long-term blood sugar (HbA1c)' },
  total_cholesterol: { key: 'cholesterol', label: 'total cholesterol' },
  ldl_cholesterol: { key: 'cholesterol', label: 'LDL cholesterol' },
  hdl_cholesterol: { key: 'cholesterol', label: 'HDL cholesterol' },
  triglycerides: { key: 'cholesterol', label: 'triglycerides' },
  sodium: { key: 'bloodPressure', label: 'sodium' },
  potassium: { key: 'potassium', label: 'potassium' },
  uric_acid: { key: 'gout', label: 'uric acid' },
  iron: { key: 'ironAbsorption', label: 'serum iron' },
};

// Active-medication category (medicationKnowledgeBase.js's free-text
// `category` field) -> the same consideration keys, matched by substring
// the way findKnowledgeEntry itself matches drug names - a curated,
// deterministic lookup, never an LLM guess at what a drug class implies.
const CATEGORY_CONSIDERATIONS = [
  { pattern: /antidiabetic/i, key: 'diabetes', label: 'blood sugar management', guidance: 'keeping carbohydrate and added-sugar intake steady across the day rather than in large spikes' },
  { pattern: /antihypertensive|diuretic/i, key: 'bloodPressure', label: 'blood pressure management', guidance: 'keeping sodium intake low and consistent day to day' },
  { pattern: /statin|fibrate/i, key: 'cholesterol', label: 'cholesterol management', guidance: 'favoring fiber-rich foods and limiting saturated fat' },
  { pattern: /xanthine oxidase/i, key: 'gout', label: 'uric acid management', guidance: (p) => `limiting purine-heavy foods like ${joinList(filterAllowed(GOUT_PURINE_FOODS, p).map((f) => f.text))}, and staying well hydrated` },
  { pattern: /proton pump inhibitor/i, key: 'reflux', label: 'acid reflux management', guidance: 'avoiding spicy, acidic, or heavy meals close to bedtime' },
  { pattern: /iron supplement/i, key: 'ironAbsorption', label: 'iron absorption', guidance: (p) => `pairing iron-rich meals with vitamin C and spacing them away from ${joinList(filterAllowed(IRON_SPACING_FOODS, p).map((f) => f.text)).replace(/, and /, ', or ').replace(/ and /, ' or ')}` },
  { pattern: /thyroid hormone/i, key: 'thyroid', label: 'thyroid medication timing', guidance: 'taking it on an empty stomach and waiting before eating, especially avoiding calcium- or iron-rich foods right after' },
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Pure, deterministic pattern computation over a window of confirmed
// entries - every number here is calculated in code, never asked of an
// LLM (same principle as insightRules.js's evaluateRules).
function computeMetrics(entries, windowDays) {
  const byDay = new Map();
  let lateNightCount = 0;
  const breakfastDays = new Set();

  for (const e of entries) {
    const key = dayKey(e.consumed_at);
    if (e.meal_type === 'breakfast') breakfastDays.add(key);
    if (e.meal_type === 'supper' || (e.meal_type === 'snack' && new Date(e.consumed_at).getHours() < 4)) {
      lateNightCount += 1;
    }

    const day = byDay.get(key) || Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f, 0]));
    for (const field of NUTRIENT_FIELDS) day[field] += Number(e[field]) || 0;
    byDay.set(key, day);
  }

  const days = [...byDay.values()];
  const loggedDayCount = days.length;
  const sum = (field) => days.reduce((total, d) => total + d[field], 0);
  const avg = (field) => (loggedDayCount > 0 ? sum(field) / loggedDayCount : 0);

  const highSodiumDayCount = days.filter((d) => d.sodium_mg > SODIUM_DAILY_LIMIT_MG).length;
  const highSugarDayCount = days.filter((d) => d.sugar_g > SUGAR_DAILY_LIMIT_G).length;
  const highCholesterolDayCount = days.filter((d) => d.cholesterol_mg > CHOLESTEROL_DAILY_LIMIT_MG).length;

  // Only judged against a real logging habit (>=5 distinct days logged in
  // the window) - a couple of sparse days shouldn't read as "you skip
  // breakfast" just because there isn't much data yet.
  const loggedEnoughToJudgeBreakfast = loggedDayCount >= 5;
  const breakfastSkipRatio = loggedEnoughToJudgeBreakfast ? 1 - breakfastDays.size / loggedDayCount : null;

  return {
    windowDays,
    entriesAnalyzedCount: entries.length,
    loggedDayCount,
    avgDailyCalories: Math.round(avg('calories')),
    avgDailySodiumMg: Math.round(avg('sodium_mg')),
    avgDailySugarG: round1(avg('sugar_g')),
    avgDailyFiberG: round1(avg('fiber_g')),
    avgDailyProteinG: round1(avg('protein_g')),
    avgDailyCarbsG: round1(avg('carbs_g')),
    avgDailyFatG: round1(avg('fat_g')),
    avgDailySaturatedFatG: round1(avg('saturated_fat_g')),
    avgDailyCholesterolMg: Math.round(avg('cholesterol_mg')),
    avgDailyPotassiumMg: Math.round(avg('potassium_mg')),
    avgDailyCalciumMg: Math.round(avg('calcium_mg')),
    avgDailyIronMg: round1(avg('iron_mg')),
    avgDailyVitaminDMcg: round1(avg('vitamin_d_mcg')),
    highSodiumDayCount,
    highSugarDayCount,
    highCholesterolDayCount,
    lateNightEntryCount: lateNightCount,
    breakfastSkipRatio,
    breakfastDayCount: breakfastDays.size,
  };
}

// Flags: which patterns are actually notable enough to become a tip -
// separated from computeMetrics so the thresholds are easy to see/test on
// their own.
function computeFlags(metrics) {
  return {
    highSodium: metrics.loggedDayCount > 0 && metrics.highSodiumDayCount / metrics.loggedDayCount >= 0.4,
    highSugar: metrics.loggedDayCount > 0 && metrics.highSugarDayCount / metrics.loggedDayCount >= 0.4,
    lowFiber: metrics.loggedDayCount >= 3 && metrics.avgDailyFiberG < FIBER_DAILY_TARGET_G,
    lowIron: metrics.loggedDayCount >= 3 && metrics.avgDailyIronMg < IRON_DAILY_TARGET_MG,
    highCholesterol: metrics.loggedDayCount > 0 && metrics.highCholesterolDayCount / metrics.loggedDayCount >= 0.4,
    frequentLateNightEating: metrics.lateNightEntryCount >= LATE_NIGHT_ENTRY_THRESHOLD,
    frequentSkippedBreakfast: metrics.breakfastSkipRatio !== null && metrics.breakfastSkipRatio >= 0.5,
  };
}

// Merges whatever a user's active medications and abnormal-flagged
// confirmed labs point at into one list of considerations, keyed so the
// same underlying concern (e.g. "diabetes") raised by both a metformin
// prescription and a high fasting-glucose result becomes a single tip
// citing both sources rather than two redundant ones.
function resolveGuidance(guidance, profile) {
  return typeof guidance === 'function' ? guidance(profile) : guidance;
}

function computeConsiderations(medications, abnormalMeasurements, profile = null) {
  const byKey = new Map();

  for (const med of medications) {
    const entry = findKnowledgeEntry(med);
    if (!entry) continue;
    const match = CATEGORY_CONSIDERATIONS.find((c) => c.pattern.test(entry.category));
    if (!match) continue;
    const existing = byKey.get(match.key) || { key: match.key, label: match.label, guidance: resolveGuidance(match.guidance, profile), medicationNames: [], labFindings: [] };
    existing.medicationNames.push(med.name);
    byKey.set(match.key, existing);
  }

  for (const m of abnormalMeasurements) {
    const mapping = LAB_CODE_CONSIDERATIONS[m.parameter_code];
    if (!mapping) continue;
    const fallbackGuidance = resolveGuidance(CATEGORY_CONSIDERATIONS.find((c) => c.key === mapping.key)?.guidance, profile)
      || 'discussing this result with a healthcare professional to see whether a dietary change is appropriate';
    const existing = byKey.get(mapping.key) || { key: mapping.key, label: mapping.label, guidance: fallbackGuidance, medicationNames: [], labFindings: [] };
    existing.labFindings.push({ label: mapping.label, statusFlag: m.status_flag, parameterDisplayName: m.parameter_display_name });
    byKey.set(mapping.key, existing);
  }

  return [...byKey.values()];
}

// "More vegetables, fruit, and legumes can help." - the foods are filtered
// by the person's diet type/allergies. With nothing left to suggest, defers
// to a dietitian rather than naming a food that doesn't fit.
function foodHint(prefix, items, profile, suffix, capitalizeList = false) {
  const names = filterAllowed(items, profile).map((f) => f.text);
  if (names.length === 0) return 'A dietitian can suggest suitable foods that fit your diet and allergies' + (suffix.endsWith('.') ? '.' : '');
  const list = joinList(names);
  const text = capitalizeList ? list.charAt(0).toUpperCase() + list.slice(1) : `${prefix} ${list}`;
  return `${text}${suffix}`;
}

function buildPatternTips(metrics, flags, considerationKeys, profile = null) {
  const tips = [];

  if (flags.highSodium) {
    const d = { avgDailySodiumMg: metrics.avgDailySodiumMg, highSodiumDayCount: metrics.highSodiumDayCount, loggedDayCount: metrics.loggedDayCount, limit: SODIUM_DAILY_LIMIT_MG };
    tips.push({
      type: 'high_sodium_intake',
      severity: considerationKeys.has('bloodPressure') ? 'important' : 'attention',
      title: 'Your sodium intake has been running high',
      templateData: d,
      heuristicDetail:
        `${d.highSodiumDayCount} of the last ${d.loggedDayCount} logged days went over ${d.limit}mg of sodium ` +
        `(averaging ${d.avgDailySodiumMg}mg/day). Try cutting back on salty snacks, processed food, and added salt` +
        `${considerationKeys.has('bloodPressure') ? ', which matters more given your blood-pressure-related medication or lab result' : ''}.`,
    });
  }

  if (flags.highSugar) {
    const d = { avgDailySugarG: metrics.avgDailySugarG, highSugarDayCount: metrics.highSugarDayCount, loggedDayCount: metrics.loggedDayCount, limit: SUGAR_DAILY_LIMIT_G };
    tips.push({
      type: 'high_sugar_intake',
      severity: considerationKeys.has('diabetes') ? 'important' : 'attention',
      title: 'Sugar intake has been high on several days',
      templateData: d,
      heuristicDetail:
        `${d.highSugarDayCount} of the last ${d.loggedDayCount} logged days went over ${d.limit}g of sugar ` +
        `(averaging ${d.avgDailySugarG}g/day). Watch sweetened drinks and desserts in particular` +
        `${considerationKeys.has('diabetes') ? ', which is especially worth watching given your diabetes-related medication or lab result' : ''}.`,
    });
  }

  if (flags.lowFiber) {
    const d = { avgDailyFiberG: metrics.avgDailyFiberG, target: FIBER_DAILY_TARGET_G };
    tips.push({
      type: 'low_fiber_intake',
      severity: 'info',
      title: 'Fiber intake looks low',
      templateData: d,
      heuristicDetail: `You're averaging about ${d.avgDailyFiberG}g of fiber a day, below the general ${d.target}g/day guideline. ${foodHint('More', FIBER_SOURCES, profile, ' can help.')}`,
    });
  }

  if (flags.lowIron) {
    const d = { avgDailyIronMg: metrics.avgDailyIronMg, target: IRON_DAILY_TARGET_MG };
    tips.push({
      type: 'low_iron_intake',
      severity: considerationKeys.has('ironAbsorption') ? 'attention' : 'info',
      title: 'Iron intake looks low',
      templateData: d,
      heuristicDetail:
        `You're averaging about ${d.avgDailyIronMg}mg of iron a day, below the general ${d.target}mg/day guideline. ` +
        `${foodHint('', IRON_SOURCES, profile, ' are common sources', true)}` +
        `${considerationKeys.has('ironAbsorption') ? ', which matters more given your iron-related medication' : ''}.`,
    });
  }

  if (flags.highCholesterol) {
    const d = { avgDailyCholesterolMg: metrics.avgDailyCholesterolMg, highCholesterolDayCount: metrics.highCholesterolDayCount, loggedDayCount: metrics.loggedDayCount, limit: CHOLESTEROL_DAILY_LIMIT_MG };
    tips.push({
      type: 'high_cholesterol_intake',
      severity: considerationKeys.has('cholesterol') ? 'important' : 'attention',
      title: 'Dietary cholesterol has been running high',
      templateData: d,
      heuristicDetail:
        `${d.highCholesterolDayCount} of the last ${d.loggedDayCount} logged days went over ${d.limit}mg of dietary cholesterol ` +
        `(averaging ${d.avgDailyCholesterolMg}mg/day). ${foodHint('', CHOLESTEROL_CONTRIBUTORS, profile, ' are common contributors', true)}` +
        `${considerationKeys.has('cholesterol') ? ', which matters more given your cholesterol-related medication or lab result' : ''}.`,
    });
  }

  if (flags.frequentLateNightEating) {
    const d = { lateNightEntryCount: metrics.lateNightEntryCount };
    tips.push({
      type: 'frequent_late_night_eating',
      severity: considerationKeys.has('reflux') ? 'attention' : 'info',
      title: 'Frequent late-night eating',
      templateData: d,
      heuristicDetail:
        `You logged ${d.lateNightEntryCount} supper/late-night items in this window. Eating close to bedtime can affect sleep and digestion` +
        `${considerationKeys.has('reflux') ? ', and is worth avoiding given your reflux-related medication' : ''}.`,
    });
  }

  if (flags.frequentSkippedBreakfast) {
    const d = { breakfastDayCount: metrics.breakfastDayCount, loggedDayCount: metrics.loggedDayCount };
    tips.push({
      type: 'frequent_skipped_breakfast',
      severity: 'info',
      title: 'Breakfast is often skipped',
      templateData: d,
      heuristicDetail: `Breakfast was only logged on ${d.breakfastDayCount} of ${d.loggedDayCount} logged days. A regular breakfast can help steady blood sugar and energy through the day.`,
    });
  }

  return tips;
}

function buildConsiderationTips(considerations) {
  return considerations.map((c) => {
    const sourceParts = [];
    if (c.medicationNames.length > 0) sourceParts.push(`your medication (${[...new Set(c.medicationNames)].join(', ')})`);
    if (c.labFindings.length > 0) {
      sourceParts.push(
        `a recent flagged lab result (${[...new Set(c.labFindings.map((f) => f.parameterDisplayName || f.label))].join(', ')})`
      );
    }
    const d = { medicationCount: c.medicationNames.length, labFindingCount: c.labFindings.length };
    return {
      type: `medical_consideration_${c.key}`,
      severity: c.labFindings.length > 0 ? 'attention' : 'info',
      title: `Diet consideration: ${c.label}`,
      templateData: d,
      heuristicDetail: `Based on ${sourceParts.join(' and ')}, it's worth ${c.guidance}.`,
    };
  });
}

async function fetchConfirmedEntries(userId, windowDays) {
  const { rows } = await pool.query(
    `SELECT ${NUTRIENT_FIELDS.join(', ')}, meal_type, consumed_at
     FROM food_entries
     WHERE user_id = $1 AND is_confirmed = true AND consumed_at >= now() - ($2::int * INTERVAL '1 day')
     ORDER BY consumed_at ASC`,
    [userId, windowDays]
  );
  return rows;
}

async function fetchActiveMedications(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM medications WHERE user_id = $1 AND status = 'active' AND is_confirmed = true`,
    [userId]
  );
  return rows;
}

// Latest confirmed measurement per diet-relevant canonical parameter,
// restricted to ones the source report (or the app's own reference range
// scoring elsewhere) flagged abnormal - mirrors dashboard.js's
// "needsAttention" query, narrowed to LAB_CODE_CONSIDERATIONS' codes.
async function fetchAbnormalDietRelevantLabs(userId) {
  const codes = Object.keys(LAB_CODE_CONSIDERATIONS);
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT hm.status_flag, hp.code AS parameter_code, hp.display_name AS parameter_display_name,
              row_number() OVER (
                PARTITION BY hm.health_parameter_id
                ORDER BY COALESCE(hm.sample_datetime::date, r.effective_date, r.created_at::date) DESC
              ) AS rank
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE r.user_id = $1 AND hm.is_confirmed = true AND hp.code = ANY($2::text[])
         AND hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')
     )
     SELECT parameter_code, parameter_display_name, status_flag FROM ranked
     WHERE rank = 1 AND status_flag IS NOT NULL AND lower(status_flag) NOT IN ('normal', 'n')`,
    [userId, codes]
  );
  return rows;
}

function allowedNumbersFromEvidence(evidence) {
  const numbers = new Set();
  const visit = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers.add(Math.round(value));
      numbers.add(Math.abs(Math.round(value)));
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(evidence);
  return numbers;
}

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

// Same hallucination guard as insightExplanationService.js's
// explanationOnlyReferencesEvidenceNumbers: rejects (falls back to the
// heuristic text) any generated tip mentioning a number not traceable to
// its own template data - a fabricated calorie/gram figure must never
// reach the user.
function textOnlyReferencesAllowedNumbers(text, allowed) {
  const found = text.match(NUMBER_PATTERN) || [];
  return found.every((token) => allowed.has(Math.round(Math.abs(Number.parseFloat(token)))));
}

async function rephraseTipWithClaude(client, tip, profile) {
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 250,
    system: [
      'You rephrase one structured diet-pattern observation into one or two warm, plain-language sentences.',
      'Use ONLY the numbers and facts given to you. Never introduce a number, food, date, or fact not present in the input.',
      'The person\'s dietary profile is a hard constraint: never mention or suggest any food that conflicts with their diet type or allergies. Any foods named in baseText are already compatible with it.',
      'Never diagnose a condition, never suggest starting, stopping, or changing a medication or dose, and never give a specific calorie/macro target unless it is present in the input.',
    ].join(' '),
    messages: [{ role: 'user', content: JSON.stringify({ type: tip.type, severity: tip.severity, title: tip.title, data: tip.templateData, baseText: tip.baseDetail, dietaryProfile: describeProfileForPrompt(profile) }) }],
  });
  recordAiUsage(FEATURES.DIET_TIPS, response);
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

async function finalizeTips(tips, userId, profile) {
  const withSafetyTail = tips.map((t) => ({
    ...t,
    baseDetail: t.heuristicDetail,
    heuristicDetail: t.severity === 'info' ? t.heuristicDetail : `${t.heuristicDetail}${SAFETY_TAIL}`,
  }));

  if (
    config.dietProvider !== 'claude' ||
    !config.anthropicApiKey ||
    withSafetyTail.length === 0 ||
    !(await isAllowed({ subjectUserId: userId, purpose: 'diet_insight' }))
  ) {
    return { tips: withSafetyTail.map((t) => ({ type: t.type, severity: t.severity, title: t.title, detail: t.heuristicDetail })), provider: 'heuristic', model: null };
  }

  const client = await getAiClient({ subjectUserId: userId, purpose: 'diet_insight' });
  const finalTips = [];
  let usedClaude = false;
  for (const tip of withSafetyTail) {
    const allowed = allowedNumbersFromEvidence(tip.templateData);
    try {
      const claudeText = await rephraseTipWithClaude(client, tip, profile);
      if (claudeText && textOnlyReferencesAllowedNumbers(claudeText, allowed)) {
        finalTips.push({ type: tip.type, severity: tip.severity, title: tip.title, detail: `${claudeText}${tip.severity === 'info' ? '' : SAFETY_TAIL}` });
        usedClaude = true;
        continue;
      }
    } catch (err) {
      // Fall through to the heuristic detail below.
    }
    finalTips.push({ type: tip.type, severity: tip.severity, title: tip.title, detail: tip.heuristicDetail });
  }
  return { tips: finalTips, provider: usedClaude ? 'claude' : 'heuristic', model: usedClaude ? config.anthropicModel : null };
}

// Regenerates and persists the user's current diet recommendation. Always
// safe to call repeatedly (e.g. every GET /api/diet/recommendations) -
// the route decides whether regeneration is actually needed based on
// entries_analyzed_count/generated_at, this function just does the work.
async function generateRecommendations(userId, windowDays = 14) {
  const [entries, medications, abnormalLabs, profile] = await Promise.all([
    fetchConfirmedEntries(userId, windowDays),
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
    fetchDietaryProfile(userId),
  ]);

  const metrics = computeMetrics(entries, windowDays);
  const flags = computeFlags(metrics);
  const considerations = computeConsiderations(medications, abnormalLabs, profile);
  const considerationKeys = new Set(considerations.map((c) => c.key));

  const tips = [...buildPatternTips(metrics, flags, considerationKeys, profile), ...buildConsiderationTips(considerations)];

  const summaryHeuristic =
    metrics.loggedDayCount === 0
      ? 'No confirmed food or drink entries in this window yet - log a few meals to get a pattern analysis.'
      : `Over the last ${metrics.loggedDayCount} logged day${metrics.loggedDayCount === 1 ? '' : 's'} (${metrics.entriesAnalyzedCount} entries), you averaged about ${metrics.avgDailyCalories} calories/day.` +
        (tips.length === 0 ? ' No notable patterns stood out - keep it up.' : ` ${tips.length} thing${tips.length === 1 ? '' : 's'} stood out below.`);

  const { tips: finalTips, provider, model } = await finalizeTips(tips, userId, profile);

  const evidence = { metrics, flags, dietaryProfile: profileSignature(profile),considerations: considerations.map(({ key, label, medicationNames, labFindings }) => ({ key, label, medicationNames, labFindings })) };

  const latestEntry = entries[entries.length - 1];
  const { rows } = await pool.query(
    `INSERT INTO diet_recommendations (user_id, window_days, entries_analyzed_count, latest_entry_considered_at, summary, tips, evidence, provider, model, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET
       window_days = EXCLUDED.window_days,
       entries_analyzed_count = EXCLUDED.entries_analyzed_count,
       latest_entry_considered_at = EXCLUDED.latest_entry_considered_at,
       summary = EXCLUDED.summary,
       tips = EXCLUDED.tips,
       evidence = EXCLUDED.evidence,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       generated_at = now(),
       updated_at = now()
     RETURNING *`,
    [userId, windowDays, metrics.entriesAnalyzedCount, latestEntry ? latestEntry.consumed_at : null, summaryHeuristic, JSON.stringify(finalTips), JSON.stringify(evidence), provider, model]
  );
  return rows[0];
}

// Whether the cached row is stale enough to regenerate: new confirmed
// entries since it was last built, or it's simply never been built.
// Also stale when the diet type or allergies changed, so a new preference
// is reflected immediately rather than after the next logged meal.
function profileSignature(profile) {
  return { dietTypes: profile.dietTypes, allergens: profile.allergens };
}

function isStale(existing, latestEntryCount, profile) {
  if (!existing) return true;
  if (existing.entries_analyzed_count !== latestEntryCount) return true;
  const stored = existing.evidence?.dietaryProfile;
  return JSON.stringify(stored || null) !== JSON.stringify(profileSignature(profile));
}

async function getOrGenerateRecommendations(userId, { windowDays = 14, forceRefresh = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM diet_recommendations WHERE user_id = $1', [userId]);
  const existing = rows[0] || null;

  if (!forceRefresh && existing && existing.window_days === windowDays) {
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS count FROM food_entries WHERE user_id = $1 AND is_confirmed = true AND consumed_at >= now() - ($2::int * INTERVAL '1 day')`,
      [userId, windowDays]
    );
    if (!isStale(existing, countRows[0].count, await fetchDietaryProfile(userId))) return existing;
  }

  return generateRecommendations(userId, windowDays);
}

module.exports = {
  computeMetrics,
  computeFlags,
  computeConsiderations,
  buildPatternTips,
  buildConsiderationTips,
  generateRecommendations,
  getOrGenerateRecommendations,
  // Reused by dietRecipeService.js so a generated recipe is grounded in
  // the exact same active-medication/abnormal-lab considerations the
  // pattern-analysis tips are - one query, one source of truth.
  fetchActiveMedications,
  fetchAbnormalDietRelevantLabs,
  // Reused by scheduleImpactService.js so a schedule's worsens/improves
  // verdict is judged against the exact same daily-intake thresholds these
  // pattern tips already use - one set of numbers, not two that can drift.
  SODIUM_DAILY_LIMIT_MG,
  SUGAR_DAILY_LIMIT_G,
  FIBER_DAILY_TARGET_G,
  IRON_DAILY_TARGET_MG,
  CHOLESTEROL_DAILY_LIMIT_MG,
  // Reused by scheduleImpactService.js for the same hallucination guard on
  // any Claude-rephrased impact-flag text.
  allowedNumbersFromEvidence,
  textOnlyReferencesAllowedNumbers,
};
