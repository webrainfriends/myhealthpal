// Calorie estimate for a workout session (issue #135 §11). Camera-only data
// is never exact, so this returns a range plus a confidence and records the
// inputs and method version so the value can be recomputed later.
//
// Method v1: kcal = MET x weight_kg x hours, with the range widened by how
// much of the input evidence is real vs defaulted.

const METHOD_VERSION = 'met-v1';
const DEFAULT_WEIGHT_KG = 70;
const DEFAULT_MET = 4.0;

function estimateCalories({ metValue, weightKg, activeSeconds }) {
  const inputs = ['exercise type', 'exercise duration'];
  const met = Number.isFinite(Number(metValue)) && Number(metValue) > 0 ? Number(metValue) : DEFAULT_MET;
  const haveWeight = Number.isFinite(Number(weightKg)) && Number(weightKg) > 0;
  const weight = haveWeight ? Number(weightKg) : DEFAULT_WEIGHT_KG;
  if (haveWeight) inputs.push('body weight');

  const seconds = Math.max(0, Number(activeSeconds) || 0);
  const hours = seconds / 3600;
  // MET values include resting metabolism (1 MET); subtract it to report
  // active calories only.
  const activeKcal = Math.max(0, (met - 1) * weight * hours);

  const confidence = haveWeight && seconds >= 60 ? 'moderate' : 'low';
  const spread = confidence === 'moderate' ? 0.15 : 0.3;
  return {
    low: Math.round(activeKcal * (1 - spread)),
    high: Math.round(activeKcal * (1 + spread)),
    confidence,
    methodVersion: METHOD_VERSION,
    inputs: { sources: inputs, met, weightKg: weight, weightIsDefault: !haveWeight, activeSeconds: seconds },
  };
}

module.exports = { estimateCalories, METHOD_VERSION };
