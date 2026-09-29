const { measureBody } = require('./measure');

// Evaluates an exercise's form rules on one frame. Every event carries the
// measured value and expected bound so the UI can show the underlying
// condition. Frames below the confidence floor produce no events at all -
// low-confidence poses never yield authoritative feedback (#135 §6).
function analyzeForm(exercise, landmarks, phase, options = {}) {
  const minConfidence = options.minConfidence ?? 0.6;
  const events = [];
  for (const rule of exercise.rules) {
    if (rule.phase !== 'any' && rule.phase !== phase) continue;
    const m = measureBody(rule.measure, landmarks, minConfidence, 'avg');
    if (!m) continue;
    const tooHigh = rule.max != null && m.value > rule.max;
    const tooLow = rule.min != null && m.value < rule.min;
    if (!tooHigh && !tooLow) continue;
    events.push({
      ruleCode: rule.code,
      severity: rule.severity,
      measuredValue: Number(m.value.toFixed(1)),
      expectedRange: { min: rule.min ?? null, max: rule.max ?? null },
      message: rule.message,
      bodySide: m.sides.length === 1 ? m.sides[0] : null,
    });
  }
  return events;
}

module.exports = { analyzeForm };
