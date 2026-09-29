const { EXERCISES } = require('./exerciseConfigs');
const { measureBody, missingLandmarks } = require('./measure');
const { midpoint } = require('./geometry');

// Auto-detect (issue #135 section 4): given ~2-4 seconds of landmark frames,
// score every catalogue exercise on (a) whether its tracked joint angle moved
// through the expected range, (b) body posture (upright / horizontal / lying)
// and (c) whether the legs move together or alternate. Returns the best guess
// with a confidence; a low confidence or a close runner-up means "ask the
// user to confirm" rather than silently assigning the exercise.

const MIN_FRAMES = 20;
const MIN_VISIBLE_FRACTION = 0.7;
const CONFIRM_BELOW = 0.6;
const CONFIRM_MARGIN = 0.15;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

// 'horizontal' when the shoulder->hip vector is closer to the x axis.
function torsoIsHorizontal(lm) {
  const sh = ['LEFT_SHOULDER', 'RIGHT_SHOULDER'].map((n) => lm[n]).filter((p) => p && p.c >= 0.5);
  const hp = ['LEFT_HIP', 'RIGHT_HIP'].map((n) => lm[n]).filter((p) => p && p.c >= 0.5);
  if (!sh.length || !hp.length) return null;
  const s = sh.length === 2 ? midpoint(sh[0], sh[1]) : sh[0];
  const h = hp.length === 2 ? midpoint(hp[0], hp[1]) : hp[0];
  return Math.abs(h.x - s.x) > Math.abs(h.y - s.y);
}

function scoreExercise(ex, frames, stats) {
  const mirror = ex.reps && ex.reps.direction === 'increase';
  const values = [];
  const sideDiffs = [];
  let visible = 0;
  for (const lm of frames) {
    const m = measureBody(ex.metric, lm, 0.5, ex.metric.combine);
    if (!m) continue;
    visible += 1;
    values.push(mirror ? 180 - m.value : m.value);
    if (m.results.length === 2) sideDiffs.push(Math.abs(m.results[0].value - m.results[1].value));
  }
  if (visible / frames.length < MIN_VISIBLE_FRACTION) return 0;

  // Posture gate.
  const h = stats.horizontalFraction;
  if (ex.posture === 'vertical' && h > 0.2) return 0;
  if (ex.posture === 'horizontal' && h < 0.8) return 0;
  if (ex.posture === 'lying' && h < 0.25) return 0;

  if (ex.kind === 'hold') {
    const amplitude = percentile(values, 0.9) - percentile(values, 0.1);
    const straight = values.filter((v) => v >= ex.hold.minAngle).length / values.length;
    return amplitude < 15 && straight >= 0.7 ? straight : 0;
  }

  const range = ex.reps.extended - ex.reps.flexed;
  const lowest = percentile(values, 0.1);
  const highest = percentile(values, 0.9);
  // Must start near the top and go down toward the flexed depth.
  if (highest < ex.reps.flexed + range * 0.5) return 0;
  const reach = (ex.reps.extended - lowest) / range;
  let score = clamp(reach / 0.75, 0, 1);
  if (reach > 1.4) score *= 1.4 / reach; // overshoots this exercise's range: probably a bigger movement

  const diff = sideDiffs.length ? sideDiffs.reduce((a, b) => a + b, 0) / sideDiffs.length : null;
  if (ex.asymmetric) score *= diff == null ? 0.5 : clamp(diff / 25, 0, 1); // alternating / staggered legs
  else if (ex.id === 'squat') score *= diff == null ? 1 : clamp(1 - diff / 30, 0.2, 1);
  return score;
}

function detectExercise(frames, candidates = Object.keys(EXERCISES)) {
  const usable = frames.filter((lm) => lm && Object.keys(lm).length > 0);
  if (usable.length < MIN_FRAMES) return { exerciseId: null, confidence: 0, candidates: [], needsConfirmation: true, reason: 'not_enough_frames' };

  const orient = usable.map(torsoIsHorizontal).filter((v) => v != null);
  const stats = { horizontalFraction: orient.length ? orient.filter(Boolean).length / orient.length : 0.5 };

  const scored = candidates
    .map((id) => ({ id, score: Number(scoreExercise(EXERCISES[id], usable, stats).toFixed(3)) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  const confidence = best.score;
  const margin = best.score - (second ? second.score : 0);
  return {
    exerciseId: confidence > 0 ? best.id : null,
    confidence,
    candidates: scored.slice(0, 3).filter((c) => c.score > 0),
    needsConfirmation: confidence < CONFIRM_BELOW || margin < CONFIRM_MARGIN,
  };
}

// Whether enough of the body is in view to attempt detection at all
// (shoulders and hips; the specific exercise's joints are checked once known).
function readyForDetection(lm) {
  return missingLandmarks(lm, ['LEFT_SHOULDER', 'LEFT_HIP'], 0.5).length === 0;
}

module.exports = { detectExercise, readyForDetection, MIN_FRAMES, CONFIRM_BELOW, CONFIRM_MARGIN };
