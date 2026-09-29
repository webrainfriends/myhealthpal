const { ema } = require('./geometry');
const { measureBody } = require('./measure');

// Rep state machine (issue #135 §5): top -> descending -> bottom -> ascending
// -> top. Only a full cycle that reached the `flexed` depth counts as valid;
// one that got past `partial` but not `flexed` is a partial rep; anything
// shallower is a false/duplicate movement and is ignored; losing the pose
// mid-rep for too long is an invalid (interrupted) rep. Frames below the
// confidence floor never advance the machine.

const DEFAULTS = { minConfidence: 0.5, smoothing: 0.5, minRepMs: 400, interruptMs: 1500, hysteresis: 8 };

function createRepCounter(exercise, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const { extended, flexed, partial } = exercise.reps;
  let state = 'top';
  let smoothed = null;
  let minValue = null;
  let repStart = null;
  let lastGoodAt = null;
  let confSum = 0;
  let confN = 0;
  let paused = true;
  const totals = { valid: 0, partial: 0, invalid: 0 };
  let repNumber = 0;

  function finish(classification, now, extra = {}) {
    repNumber += 1;
    totals[classification] += 1;
    const rom = Math.max(0, Math.min(1, (extended - minValue) / (extended - flexed)));
    const rep = {
      repNumber,
      classification,
      rangeOfMotionScore: Number(rom.toFixed(3)),
      minValue: Number(minValue.toFixed(1)),
      startedAt: repStart,
      completedAt: now,
      durationMs: now - repStart,
      confidence: Number((confN ? confSum / confN : 0).toFixed(3)),
      ...extra,
    };
    state = 'top';
    minValue = null;
    repStart = null;
    confSum = 0;
    confN = 0;
    return rep;
  }

  // Feed one frame; returns { rep, state, paused, value } - `rep` is set on
  // the frame a rep completes.
  function update(landmarks, now) {
    const m = measureBody(exercise.metric, landmarks, opt.minConfidence, exercise.metric.combine);
    if (!m) {
      paused = true;
      if (state !== 'top' && lastGoodAt != null && now - lastGoodAt > opt.interruptMs) {
        return { rep: finish('invalid', now, { issue: 'interrupted' }), state, paused, value: smoothed };
      }
      return { rep: null, state, paused, value: smoothed };
    }
    paused = false;
    lastGoodAt = now;
    smoothed = ema(smoothed, m.value, opt.smoothing);
    const v = smoothed;
    let rep = null;

    if (state === 'top') {
      if (v < extended - opt.hysteresis) {
        state = 'descending';
        repStart = now;
        minValue = v;
        confSum = 0;
        confN = 0;
      }
    } else {
      minValue = Math.min(minValue, v);
      confSum += m.confidence;
      confN += 1;
      if (state === 'descending') {
        if (v <= flexed) state = 'bottom';
        else if (v >= extended) rep = closeShallow(now);
      } else if (state === 'bottom') {
        if (v > flexed + opt.hysteresis) state = 'ascending';
      } else if (state === 'ascending') {
        if (v <= flexed) state = 'bottom';
        else if (v >= extended) {
          rep = now - repStart < opt.minRepMs ? dropFalse() : finish('valid', now);
        }
      }
    }
    return { rep, state, paused, value: v };
  }

  // Returned to the top without reaching full depth.
  function closeShallow(now) {
    if (now - repStart < opt.minRepMs || minValue > partial) return dropFalse();
    return finish('partial', now, { issue: 'incomplete_range' });
  }

  function dropFalse() {
    state = 'top';
    minValue = null;
    repStart = null;
    return null;
  }

  return {
    update,
    get totals() { return { ...totals }; },
    get state() { return state; },
    get paused() { return paused; },
    reset() { state = 'top'; smoothed = null; minValue = null; repStart = null; },
  };
}

module.exports = { createRepCounter };
