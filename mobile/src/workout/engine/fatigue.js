// Within-session fatigue check (issue #135 Phase 5). Compares the most recent
// completed set with the first one using only measured per-rep data: falling
// range of motion, a falling share of valid reps, or slowing tempo. Pure so
// it can run on-device between sets without the network.

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function setStats(set) {
  const reps = set.reps || [];
  const roms = reps.map((r) => r.rangeOfMotionScore).filter((v) => typeof v === 'number');
  const ups = reps.map((r) => r.concentricMs).filter((v) => typeof v === 'number');
  return {
    rom: avg(roms),
    validRatio: reps.length ? reps.filter((r) => r.classification === 'valid').length / reps.length : null,
    concentricMs: avg(ups),
  };
}

// `sets` are the runner's completed-set payloads. Needs at least 2 sets.
function fatigueCheck(sets) {
  if (!sets || sets.length < 2) return { fatigued: false, reasons: [] };
  const first = setStats(sets[0]);
  const last = setStats(sets[sets.length - 1]);
  const reasons = [];
  if (first.rom != null && last.rom != null && first.rom - last.rom >= 0.1) reasons.push('range_of_motion');
  if (first.validRatio != null && last.validRatio != null && first.validRatio - last.validRatio >= 0.2) reasons.push('valid_rate');
  if (first.concentricMs && last.concentricMs && last.concentricMs / first.concentricMs >= 1.4) reasons.push('slower_lifts');
  return { fatigued: reasons.length > 0, reasons };
}

module.exports = { fatigueCheck };
