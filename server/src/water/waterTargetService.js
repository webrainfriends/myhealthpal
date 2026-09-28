const pool = require('../db/pool');
const config = require('../config');
const { getAiClient, isAllowed } = require('../ai/privacyGateway');
const { recordAiUsage, FEATURES } = require('../services/aiUsageService');
const { findKnowledgeEntry } = require('../medications/medicationLinkingService');
const {
  computeConsiderations,
  fetchActiveMedications,
  fetchAbnormalDietRelevantLabs,
  allowedNumbersFromEvidence,
  textOnlyReferencesAllowedNumbers,
} = require('../diet/dietInsightService');

// A personalized daily water-intake target (min/ideal/max), the same
// deterministic-evidence-then-optional-Claude-rephrase shape
// dietInsightService.js's diet recommendations use - reusing its exported
// hallucination guard directly rather than reimplementing it.
//
// Grounded in the same four data sources dietRecipeService.generateRecipeFeed
// already assembles for a person (medications, abnormal labs, weight, recent
// activity) - there is no height/age/sex/climate field anywhere in this
// schema, so weight (ml/kg) is the primary driver, adjusted by the rest.

const SAFETY_TAIL =
  ' This is a general estimate, not medical advice - talk to a healthcare professional about your personal fluid ' +
  'needs, especially if you have kidney, heart, or liver conditions.';

// General population guideline (~30-35ml/kg/day for a healthy adult) -
// min/max give a reasonable band around that, not hard clinical limits.
const ML_PER_KG_MIN = 25;
const ML_PER_KG_IDEAL = 33;
const ML_PER_KG_MAX = 45;

// Fallback when no weight is recorded yet (Diet > Weight goal) - general
// adult guidance in the commonly-cited 2-3.5L/day range.
const DEFAULT_MIN_ML = 2000;
const DEFAULT_IDEAL_ML = 2500;
const DEFAULT_MAX_ML = 3500;

const ACTIVE_BONUS_ML = 500; // extra for sweat losses at a high activity level
const DIURETIC_BONUS_ML = 500; // diuretics increase fluid loss
const GOUT_BONUS_ML = 300; // hydration supports uric acid clearance
const KIDNEY_CAUTION_MAX_ML = 2000; // conservative cap pending a clinician's own limit

// Not covered by dietInsightService's LAB_CODE_CONSIDERATIONS (which has no
// kidney-function mapping) - checked directly here since impaired kidney
// function is the one condition where "drink more" can be actively unsafe.
const KIDNEY_LAB_CODES = ['creatinine', 'egfr', 'bun', 'urea'];

async function fetchWeightKg(userId) {
  const { rows } = await pool.query('SELECT current_weight_kg FROM user_weight_goals WHERE user_id = $1', [userId]);
  const value = rows[0]?.current_weight_kg;
  return value != null ? Number(value) : null;
}

// Mirrors dietRecipeService.js's fetchRecentActivity/describeActivity
// thresholds (ACTIVITY_GOALS.steps = 10000) - duplicated rather than
// imported since that module doesn't export them (its own comment on
// ACTIVITY_GOALS explains why fixed goals are duplicated per-file rather
// than cross-imported from a route).
async function fetchActivityLevel(userId) {
  const { rows } = await pool.query(
    `SELECT steps FROM activity_logs WHERE user_id = $1 AND log_date >= CURRENT_DATE - 13 AND steps IS NOT NULL`,
    [userId]
  );
  if (rows.length === 0) return null;
  const avgSteps = rows.reduce((sum, r) => sum + r.steps, 0) / rows.length;
  if (avgSteps >= 10000) return 'active';
  if (avgSteps >= 5000) return 'moderately active';
  return 'low activity';
}

// Latest confirmed, non-duplicate, abnormal-flagged kidney-relevant lab -
// same query shape as dietInsightService.fetchAbnormalDietRelevantLabs, just
// against a different code list.
async function fetchAbnormalKidneyLab(userId) {
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
    [userId, KIDNEY_LAB_CODES]
  );
  return rows[0] || null;
}

function hasDiureticMedication(medications) {
  return medications.some((med) => {
    const entry = findKnowledgeEntry(med);
    return Boolean(entry && /diuretic/i.test(entry.category));
  });
}

// Every number this function produces goes straight into templateData
// below, so any Claude rephrase can only ever cite numbers computed here -
// never asked of, or invented by, the model itself.
async function computeTarget(userId) {
  const [weightKg, medications, abnormalLabs, activityLevel, kidneyLab] = await Promise.all([
    fetchWeightKg(userId),
    fetchActiveMedications(userId),
    fetchAbnormalDietRelevantLabs(userId),
    fetchActivityLevel(userId),
    fetchAbnormalKidneyLab(userId),
  ]);
  const considerations = computeConsiderations(medications, abnormalLabs);

  const weightBased = weightKg != null && weightKg > 0;
  let min;
  let ideal;
  let max;
  if (weightBased) {
    min = Math.round(weightKg * ML_PER_KG_MIN);
    ideal = Math.round(weightKg * ML_PER_KG_IDEAL);
    max = Math.round(weightKg * ML_PER_KG_MAX);
  } else {
    min = DEFAULT_MIN_ML;
    ideal = DEFAULT_IDEAL_ML;
    max = DEFAULT_MAX_ML;
  }

  const reasons = [];
  if (activityLevel === 'active') {
    ideal += ACTIVE_BONUS_ML;
    max += ACTIVE_BONUS_ML;
    reasons.push('your activity level');
  }
  if (hasDiureticMedication(medications)) {
    ideal += DIURETIC_BONUS_ML;
    max += DIURETIC_BONUS_ML;
    reasons.push('a diuretic medication you take');
  }
  if (considerations.some((c) => c.key === 'gout')) {
    ideal += GOUT_BONUS_ML;
    reasons.push('staying well hydrated for uric acid/gout management');
  }
  let kidneyCaution = false;
  if (kidneyLab) {
    kidneyCaution = true;
    // A hard, conservative reset (not just a Math.min cap) - a
    // weight-based min above this cap would otherwise leave no coherent
    // band at all once max is pulled down, which is exactly the case this
    // guard exists for: fluid limits here genuinely need a doctor's own
    // number, so this app shows one deliberately narrow, cautious estimate
    // rather than trying to preserve its usual wider band.
    max = KIDNEY_CAUTION_MAX_ML;
    ideal = Math.round(max * 0.85);
    min = Math.round(max * 0.6);
    reasons.push(
      `a flagged ${kidneyLab.parameter_display_name || 'kidney-related'} lab result - fluid limits should be personalized by your doctor`
    );
  }

  const templateData = {
    minMl: min,
    idealMl: ideal,
    maxMl: max,
    weightKg: weightBased ? Math.round(weightKg * 10) / 10 : null,
  };

  const heuristicSummary = weightBased
    ? `Based on a body weight of ${templateData.weightKg}kg${reasons.length ? ` and ${reasons.join(', ')}` : ''}, ` +
      `aim for roughly ${ideal}ml (about ${min}-${max}ml) of water a day.`
    : `No recorded body weight yet, so this uses a general adult guideline${reasons.length ? `, adjusted for ${reasons.join(', ')}` : ''}: ` +
      `aim for roughly ${ideal}ml (about ${min}-${max}ml) of water a day. Add your weight under Diet > Weight goal for a number tailored to you.`;

  const evidence = {
    templateData,
    considerations: considerations.map(({ key, label }) => ({ key, label })),
    activityLevel,
    kidneyCaution,
  };

  return { min, ideal, max, weightKg: weightBased ? weightKg : null, heuristicSummary, templateData, evidence };
}

async function rephraseWithClaude(client, templateData) {
  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 200,
    system: [
      'You rephrase one structured daily water-intake target into one or two warm, plain-language sentences.',
      'Use ONLY the numbers and facts given to you. Never introduce a number, condition, or fact not present in the input.',
      "Never diagnose a condition, never suggest starting, stopping, or changing a medication, and never claim to replace a doctor's advice on fluid limits.",
    ].join(' '),
    messages: [{ role: 'user', content: JSON.stringify(templateData) }],
  });
  recordAiUsage(FEATURES.DIET_TIPS, response);
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

// Same hallucination-guard rephrase pattern as dietInsightService.finalizeTips,
// reusing its exact allowedNumbersFromEvidence/textOnlyReferencesAllowedNumbers
// helpers: a Claude rephrase mentioning a number not traceable to templateData
// is discarded in favor of the deterministic heuristic sentence.
async function finalizeSummary(userId, templateData, heuristicSummary) {
  const heuristicWithTail = `${heuristicSummary}${SAFETY_TAIL}`;

  if (
    config.dietProvider !== 'claude' ||
    !config.anthropicApiKey ||
    !(await isAllowed({ subjectUserId: userId, purpose: 'diet_insight' }))
  ) {
    return { summary: heuristicWithTail, provider: 'heuristic', model: null };
  }

  const client = await getAiClient({ subjectUserId: userId, purpose: 'diet_insight' });
  const allowed = allowedNumbersFromEvidence(templateData);
  try {
    const claudeText = await rephraseWithClaude(client, templateData);
    if (claudeText && textOnlyReferencesAllowedNumbers(claudeText, allowed)) {
      return { summary: `${claudeText}${SAFETY_TAIL}`, provider: 'claude', model: config.anthropicModel };
    }
  } catch (err) {
    // Falls through to the heuristic summary below.
  }
  return { summary: heuristicWithTail, provider: 'heuristic', model: null };
}

async function generateWaterTarget(userId) {
  const computed = await computeTarget(userId);
  const { summary, provider, model } = await finalizeSummary(userId, computed.templateData, computed.heuristicSummary);

  const { rows } = await pool.query(
    `INSERT INTO water_targets (user_id, min_ml, ideal_ml, max_ml, weight_kg_considered, computed_date, summary, evidence, provider, model, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET
       min_ml = EXCLUDED.min_ml,
       ideal_ml = EXCLUDED.ideal_ml,
       max_ml = EXCLUDED.max_ml,
       weight_kg_considered = EXCLUDED.weight_kg_considered,
       computed_date = EXCLUDED.computed_date,
       summary = EXCLUDED.summary,
       evidence = EXCLUDED.evidence,
       provider = EXCLUDED.provider,
       model = EXCLUDED.model,
       generated_at = now(),
       updated_at = now()
     RETURNING *`,
    [userId, computed.min, computed.ideal, computed.max, computed.weightKg, summary, JSON.stringify(computed.evidence), provider, model]
  );
  return rows[0];
}

function toDateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// Stale once a day has passed (medications/labs/weight can't be tracked for
// finer-grained change the way diet_recommendations tracks entries_analyzed_count),
// or immediately if the person's recorded weight has since changed.
function isStale(existing, currentWeightKg) {
  if (!existing) return true;
  if (toDateOnly(existing.computed_date) !== toDateOnly(new Date())) return true;
  const existingWeight = existing.weight_kg_considered != null ? Number(existing.weight_kg_considered) : null;
  return existingWeight !== currentWeightKg;
}

async function getOrGenerateWaterTarget(userId, { forceRefresh = false } = {}) {
  const { rows } = await pool.query('SELECT * FROM water_targets WHERE user_id = $1', [userId]);
  const existing = rows[0] || null;

  if (!forceRefresh && existing) {
    const currentWeightKg = await fetchWeightKg(userId);
    if (!isStale(existing, currentWeightKg)) return existing;
  }
  return generateWaterTarget(userId);
}

// Deterministic (never AI-touched) comparison of today's logged total
// against the cached target, so an under/over alert can never be affected
// by a model's own wording - only by the numbers computeTarget produced.
function evaluateIntake(totalMl, target) {
  if (totalMl < target.min_ml) {
    return { status: 'under', message: `You're ${target.min_ml - totalMl}ml under today's minimum of ${target.min_ml}ml.` };
  }
  if (totalMl > target.max_ml) {
    return {
      status: 'over',
      message:
        `You're ${totalMl - target.max_ml}ml over today's recommended maximum of ${target.max_ml}ml. Drinking much ` +
        'more than this can occasionally cause water intoxication (low blood sodium) - consider spacing it out, and ' +
        'check with a doctor if this is a regular pattern.',
    };
  }
  return { status: 'ok', message: null };
}

module.exports = { computeTarget, generateWaterTarget, getOrGenerateWaterTarget, evaluateIntake };
