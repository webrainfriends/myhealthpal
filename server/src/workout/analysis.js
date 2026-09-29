// Pure session analytics (issue #135 §8-§10). Everything here is computed
// from stored rep/set rows so summaries stay grounded in measured data.

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d = 2) => (v == null ? null : Number(v.toFixed(d)));

// Mean actual seconds per tempo phase over reps that carry tempo data.
function averageTempo(reps) {
  const col = (k) => reps.map((r) => num(r[k])).filter((v) => v != null);
  const down = col('eccentric_ms');
  const pause = col('hold_ms');
  const up = col('concentric_ms');
  if (!down.length && !up.length) return null;
  return {
    downSeconds: round(avg(down) / 1000, 1),
    pauseSeconds: pause.length ? round(avg(pause) / 1000, 1) : null,
    upSeconds: up.length ? round(avg(up) / 1000, 1) : null,
    reps: Math.max(down.length, up.length),
  };
}

// 0-1: mean over phases that have a target of (1 - relative deviation),
// averaged across reps. A pause target of 0 is ignored (no useful ratio).
function tempoAdherence(reps, target) {
  if (!target) return null;
  const phases = [
    ['eccentric_ms', target.down],
    ['hold_ms', target.pause],
    ['concentric_ms', target.up],
  ].filter(([, t]) => t != null && t > 0);
  if (!phases.length) return null;
  const perRep = [];
  for (const r of reps) {
    const scores = phases
      .map(([k, t]) => (num(r[k]) == null ? null : Math.max(0, 1 - Math.abs(r[k] / 1000 - t) / t)))
      .filter((v) => v != null);
    if (scores.length) perRep.push(avg(scores));
  }
  return perRep.length ? round(avg(perRep), 3) : null;
}

// Left/right consistency: mean symmetry_score, or null when unmeasured
// (e.g. side-on camera sees only one side).
function symmetry(reps) {
  const xs = reps.map((r) => num(r.symmetry_score)).filter((v) => v != null);
  return xs.length ? round(avg(xs), 3) : null;
}

// Movement-quality trend first -> last set plus a within-session fatigue
// flag: valid-rep ratio or ROM dropping meaningfully by the final set.
function qualityTrend(repsBySet) {
  const nums = [...repsBySet.keys()].sort((a, b) => a - b);
  if (nums.length < 2) return null;
  const stat = (reps) => ({
    rom: avg(reps.map((r) => num(r.range_of_motion_score)).filter((v) => v != null)),
    validRatio: reps.length ? reps.filter((r) => r.classification === 'valid').length / reps.length : null,
  });
  const first = stat(repsBySet.get(nums[0]));
  const last = stat(repsBySet.get(nums[nums.length - 1]));
  const romDrop = first.rom != null && last.rom != null ? first.rom - last.rom : null;
  const validDrop = first.validRatio != null && last.validRatio != null ? first.validRatio - last.validRatio : null;
  return {
    firstSet: { rom: round(first.rom, 3), validRatio: round(first.validRatio, 3) },
    lastSet: { rom: round(last.rom, 3), validRatio: round(last.validRatio, 3) },
    romChange: romDrop == null ? null : round(-romDrop, 3),
    fatigueDetected: (romDrop != null && romDrop >= 0.1) || (validDrop != null && validDrop >= 0.2),
  };
}

// Compare this session with the previous completed one for the same
// exercise: valid reps, total volume, ROM and valid-rate deltas.
function compareSessions(current, previous) {
  if (!previous) return null;
  const delta = (a, b) => (a == null || b == null ? null : round(a - b, 3));
  return {
    previousDate: previous.completedAt,
    validReps: { current: current.validReps, previous: previous.validReps, change: current.validReps - previous.validReps },
    rom: { current: round(current.rom, 3), previous: round(previous.rom, 3), change: delta(current.rom, previous.rom) },
    validRatio: { current: round(current.validRatio, 3), previous: round(previous.validRatio, 3), change: delta(current.validRatio, previous.validRatio) },
  };
}

module.exports = { averageTempo, tempoAdherence, symmetry, qualityTrend, compareSessions };
