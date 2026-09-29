// Calorie estimate for a workout session (issue #135 §11). Camera-only data
// is never exact, so this returns a range plus a confidence and records the
// inputs and method version so the value can be recomputed later.
//
// Method v1: kcal = MET x weight_kg x hours, with the range widened by how
// much of the input evidence is real vs defaulted.

const METHOD_VERSION = 'met-v1';
// v2 adds measured heart rate / device active energy (Phase 4). v1 remains
// the method whenever neither is available, so older sessions stay
// reproducible from their stored inputs.
const METHOD_VERSION_HR = 'met-hr-v2';
const HR_REFERENCE_BPM = 110; // typical moderate-exercise average the MET table assumes
const DEFAULT_WEIGHT_KG = 70;
const DEFAULT_MET = 4.0;

function estimateCalories({ metValue, weightKg, activeSeconds, heartRate = null, deviceActiveKcal = null }) {
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

  const baseInputs = { met, weightKg: weight, weightIsDefault: !haveWeight, activeSeconds: seconds };

  // A wearable/phone-reported active energy for the workout window is the
  // best evidence available: use it directly with a narrow range.
  const device = Number(deviceActiveKcal);
  if (Number.isFinite(device) && device > 0) {
    return {
      low: Math.round(device * 0.9),
      high: Math.round(device * 1.1),
      confidence: 'high',
      methodVersion: METHOD_VERSION_HR,
      inputs: { ...baseInputs, sources: [...inputs, 'device active energy'], deviceActiveKcal: Math.round(device) },
    };
  }

  // Measured average heart rate rescales the MET estimate around the
  // reference intensity, clamped to +-25% because we have no age/sex to
  // interpret absolute bpm more precisely.
  const bpm = Number(heartRate?.avgBpm);
  if (Number.isFinite(bpm) && bpm > 0 && (heartRate?.sampleCount ?? 0) >= 3) {
    const scale = Math.max(0.75, Math.min(1.25, 1 + (bpm - HR_REFERENCE_BPM) / HR_REFERENCE_BPM));
    const scaled = activeKcal * scale;
    const confidence = haveWeight && seconds >= 300 ? 'high' : 'moderate';
    const spread = confidence === 'high' ? 0.12 : 0.18;
    return {
      low: Math.round(scaled * (1 - spread)),
      high: Math.round(scaled * (1 + spread)),
      confidence,
      methodVersion: METHOD_VERSION_HR,
      inputs: { ...baseInputs, sources: [...inputs, 'heart rate'], avgBpm: Math.round(bpm), hrScale: Number(scale.toFixed(2)) },
    };
  }

  const confidence = haveWeight && seconds >= 60 ? 'moderate' : 'low';
  const spread = confidence === 'moderate' ? 0.15 : 0.3;
  return {
    low: Math.round(activeKcal * (1 - spread)),
    high: Math.round(activeKcal * (1 + spread)),
    confidence,
    methodVersion: METHOD_VERSION,
    inputs: { ...baseInputs, sources: inputs },
  };
}

module.exports = { estimateCalories, METHOD_VERSION, METHOD_VERSION_HR };
