const { createRepCounter } = require('./repCounter');
const { createHoldTracker } = require('./holdTracker');
const { analyzeForm } = require('./formAnalyzer');

// Ties the per-exercise counter/tracker and form rules into a set/rest
// session. Pure state machine (no React, no timers of its own): the caller
// feeds it landmark frames and ticks, so the live loop never touches the
// network and the whole flow is testable. Produces the exact per-set payload
// the server's POST /:id/sets accepts.

const EVENT_GAP_MS = 2000; // same rule is logged at most this often
const MAX_EVENTS_PER_SET = 200;
const MAX_FRAME_GAP_MS = 1000; // longer gaps are not counted as active time

// Flags a rep whose lowering or lifting phase was clearly faster than the
// planned tempo (under 60% of target). Only valid reps carry tempo data.
function tempoCueFor(rep, tempo) {
  if (!tempo || rep.eccentricMs == null) return null;
  if (tempo.down && rep.eccentricMs < tempo.down * 1000 * 0.6) {
    return { ruleCode: 'TEMPO_DOWN_FAST', severity: 'minor', measuredValue: Number((rep.eccentricMs / 1000).toFixed(1)), expectedRange: { min: tempo.down, max: null }, message: 'Slow down the lowering phase.', bodySide: null };
  }
  if (tempo.up && rep.concentricMs < tempo.up * 1000 * 0.6) {
    return { ruleCode: 'TEMPO_UP_FAST', severity: 'minor', measuredValue: Number((rep.concentricMs / 1000).toFixed(1)), expectedRange: { min: tempo.up, max: null }, message: 'Control the lifting phase.', bodySide: null };
  }
  return null;
}

const iso = (ms) => new Date(ms).toISOString();

// tempo: optional { down, pause, up } target seconds per rep phase.
function createWorkoutRunner({ exercise, targetSets, targetReps, targetHoldSeconds, targetRestSeconds = 60, tempo = null, options = {} }) {
  const isHold = exercise.kind === 'hold';
  const counter = isHold ? null : createRepCounter(exercise, options);
  const hold = isHold ? createHoldTracker(exercise, options) : null;

  let phase = 'active'; // 'active' | 'rest' | 'done'
  let setNumber = 1;
  let setStart = null;
  let reps = [];
  let formEvents = [];
  let eventSeq = 0;
  const lastEventAt = new Map();
  const sets = [];
  let restStartedAt = null;
  let activeMs = 0;
  let lastFrameAt = null;
  let paused = true;

  const validInSet = () => reps.filter((r) => r.classification === 'valid').length;

  function buildSet(now) {
    return {
      clientId: `s${setNumber}`,
      setNumber,
      startedAt: setStart != null ? iso(setStart) : undefined,
      completedAt: iso(now),
      holdSeconds: isHold ? hold.heldSeconds : undefined,
      restSecondsAfter: null,
      reps: reps.map((r) => ({ ...r, clientId: `r${r.repNumber}`, startedAt: iso(r.startedAt), completedAt: iso(r.completedAt), metrics: { minAngle: r.minValue, issue: r.issue } })),  // tempo/symmetry travel as top-level rep fields
      formEvents,
    };
  }

  function completeSet(now) {
    sets.push(buildSet(now));
    reps = [];
    formEvents = [];
    lastEventAt.clear();
    setStart = null;
    if (counter) counter.reset();
    if (hold) hold.reset();
    if (setNumber >= targetSets) {
      phase = 'done';
    } else {
      phase = 'rest';
      restStartedAt = now;
      setNumber += 1;
    }
  }

  // Returns the events this frame produced: rep / cue / set_complete.
  function feed(landmarks, now) {
    const events = [];
    if (phase !== 'active') return { events, paused: true };
    if (lastFrameAt != null && !paused) activeMs += Math.min(now - lastFrameAt, MAX_FRAME_GAP_MS);
    lastFrameAt = now;

    let state = 'top';
    if (isHold) {
      const h = hold.update(landmarks, now);
      paused = h.paused;
      if (setStart == null && h.holding) setStart = now;
      if (targetHoldSeconds && h.heldSeconds >= targetHoldSeconds) {
        completeSet(now);
        events.push({ type: 'set_complete', setNumber: sets.length, phase });
        return { events, paused };
      }
    } else {
      const r = counter.update(landmarks, now);
      paused = r.paused;
      state = r.state;
      if (setStart == null && state !== 'top') setStart = now;
      if (r.rep) {
        reps.push(r.rep);
        events.push({ type: 'rep', rep: r.rep });
        const tempoCue = tempoCueFor(r.rep, tempo);
        if (tempoCue) recordCue(events, tempoCue, now);
      }
      if (targetReps && validInSet() >= targetReps) {
        completeSet(now);
        events.push({ type: 'set_complete', setNumber: sets.length, phase });
        return { events, paused };
      }
    }

    if (!paused) {
      for (const ev of analyzeForm(exercise, landmarks, state === 'bottom' ? 'bottom' : 'any', options)) {
        recordCue(events, ev, now);
      }
    }
    return { events, paused };
  }

  // Emits a cue event and logs it as a form event, at most once per rule
  // per EVENT_GAP_MS so the log (and the coach) aren't spammed.
  function recordCue(events, ev, now) {
    if (now - (lastEventAt.get(ev.ruleCode) ?? -Infinity) < EVENT_GAP_MS) return;
    lastEventAt.set(ev.ruleCode, now);
    events.push({ type: 'cue', ...ev });
    if (formEvents.length < MAX_EVENTS_PER_SET) {
      eventSeq += 1;
      formEvents.push({ clientId: `e${eventSeq}`, timestampMs: Math.max(0, now - (setStart ?? now)), ...ev });
    }
  }

  function startNextSet(now) {
    if (phase !== 'rest') return;
    sets[sets.length - 1].restSecondsAfter = Math.round((now - restStartedAt) / 1000);
    phase = 'active';
    lastFrameAt = null;
    restStartedAt = null;
  }

  // Ends the session early: an in-progress set with any activity is kept.
  function finish(now) {
    if (phase === 'rest') {
      sets[sets.length - 1].restSecondsAfter = Math.round((now - restStartedAt) / 1000);
    } else if (phase === 'active' && (reps.length > 0 || (hold && hold.heldSeconds > 0))) {
      completeSet(now);
    }
    phase = 'done';
    return sets;
  }

  return {
    feed,
    startNextSet,
    finish,
    get phase() { return phase; },
    get setNumber() { return setNumber; },
    get sets() { return sets; },
    get activeSeconds() { return Math.round(activeMs / 1000); },
    get paused() { return paused; },
    get restStartedAt() { return restStartedAt; },
    get targetRestSeconds() { return targetRestSeconds; },
    get current() {
      const partial = reps.filter((r) => r.classification === 'partial').length;
      const invalid = reps.filter((r) => r.classification === 'invalid').length;
      return {
        valid: validInSet(),
        partial,
        invalid,
        heldSeconds: hold ? hold.heldSeconds : 0,
      };
    },
  };
}

module.exports = { createWorkoutRunner };
