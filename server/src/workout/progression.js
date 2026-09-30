// Progression and history analytics (issue #135 Phase 5). Pure functions over
// completed-session summaries: every suggestion carries the rule that
// produced it so the app can explain it, and nothing here is a medical
// recommendation - it only nudges targets based on measured performance.

const REP_STEP = 2;
const REP_CAP = 30;
const HOLD_STEP = 5;
const HOLD_CAP = 120;
const SETS_CAP = 5;

// A "session" here is:
//  { targetSets, targetReps, targetHoldSeconds, targetRestSeconds, isHold,
//    plannedRepsAchieved, correctFormRatio, fatigueDetected, completedAt }
// newest first. Returns null when there is no history to base a suggestion on.
function suggestNext(sessions) {
  const recent = sessions.slice(0, 3);
  if (recent.length === 0) return null;
  const last = recent[0];
  const rest = last.targetRestSeconds ?? 60;

  const base = {
    sets: last.targetSets,
    reps: last.isHold ? null : last.targetReps,
    holdSeconds: last.isHold ? last.targetHoldSeconds : null,
    restSeconds: rest,
  };
  const basedOn = { sessions: recent.length };

  const form = last.correctFormRatio;
  const done = last.plannedRepsAchieved;
  const fatigueTwice = recent.length >= 2 && recent[0].fatigueDetected && recent[1].fatigueDetected;

  // Form slipping or repeated fatigue: hold steady with more recovery.
  if ((form != null && form < 0.7) || fatigueTwice) {
    return {
      action: 'deload',
      targets: { ...base, restSeconds: Math.min(rest + 15, 300) },
      reason: form != null && form < 0.7
        ? `Only ${Math.round(form * 100)}% of reps had good form last time, so keep the same targets and rest a little longer.`
        : 'Fatigue showed up in your last two sessions, so keep the same targets and rest a little longer.',
      basedOn,
    };
  }

  // Hit the plan with solid form and no fatigue: progress one step.
  if (done != null && done >= 0.95 && form != null && form >= 0.85 && !last.fatigueDetected) {
    if (last.isHold) {
      const hold = Math.min(base.holdSeconds + HOLD_STEP, HOLD_CAP);
      return { action: hold > base.holdSeconds ? 'progress' : 'maintain', targets: { ...base, holdSeconds: hold }, reason: `You completed ${Math.round(done * 100)}% of the plan with ${Math.round(form * 100)}% good form, so add ${HOLD_STEP} seconds.`, basedOn };
    }
    if (base.reps + REP_STEP <= REP_CAP) {
      return { action: 'progress', targets: { ...base, reps: base.reps + REP_STEP }, reason: `You completed ${Math.round(done * 100)}% of the plan with ${Math.round(form * 100)}% good form, so add ${REP_STEP} reps per set.`, basedOn };
    }
    if (base.sets < SETS_CAP) {
      return { action: 'progress', targets: { ...base, sets: base.sets + 1, reps: Math.max(8, base.reps - 6) }, reason: 'You have reached a high rep count, so add a set and lower the reps.', basedOn };
    }
    return { action: 'maintain', targets: base, reason: 'You are at the top of the suggested range - keep these targets.', basedOn };
  }

  return {
    action: 'maintain',
    targets: base,
    reason: done != null && done < 0.95
      ? `You completed ${Math.round(done * 100)}% of the plan last time, so repeat the same targets.`
      : 'Repeat the same targets until you hit them with good form.',
    basedOn,
  };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Per-exercise history for the trends card: newest-first sessions in,
// summary with direction of travel out (second half vs first half).
function buildAnalytics(sessions) {
  const chrono = [...sessions].reverse();
  const validReps = chrono.map((s) => s.validReps);
  const half = Math.floor(chrono.length / 2);
  let direction = null;
  if (chrono.length >= 4) {
    const early = avg(validReps.slice(0, half));
    const late = avg(validReps.slice(-half));
    direction = late > early * 1.05 ? 'up' : late < early * 0.95 ? 'down' : 'steady';
  }
  const best = sessions.reduce((b, s) => (s.bestSetReps > (b?.bestSetReps ?? -1) ? s : b), null);
  return {
    sessions: chrono.length,
    totalValidReps: validReps.reduce((a, b) => a + b, 0),
    bestSetReps: best ? best.bestSetReps : null,
    avgFormRatio: avg(chrono.map((s) => s.correctFormRatio).filter((v) => v != null)),
    direction,
    recent: sessions.slice(0, 10).map((s) => ({ date: s.completedAt, validReps: s.validReps, formRatio: s.correctFormRatio })),
  };
}

module.exports = { suggestNext, buildAnalytics };
