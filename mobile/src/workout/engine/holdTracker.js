const { measureBody } = require('./measure');

// Isometric holds (plank): time accrues only while the body line is within
// spec and the pose is confident. Losing either pauses the clock rather than
// silently counting time the user wasn't holding.
function createHoldTracker(exercise, options = {}) {
  const minConfidence = options.minConfidence ?? 0.5;
  let heldMs = 0;
  let last = null;
  let holding = false;

  function update(landmarks, now) {
    const m = measureBody(exercise.metric, landmarks, minConfidence, exercise.metric.combine);
    holding = !!m && m.value >= exercise.hold.minAngle;
    if (holding && last != null) heldMs += now - last;
    last = m ? now : null;
    return { holding, paused: !m, heldSeconds: Math.floor(heldMs / 1000) };
  }

  return {
    update,
    get heldSeconds() { return Math.floor(heldMs / 1000); },
    get holding() { return holding; },
    reset() { heldMs = 0; last = null; holding = false; },
  };
}

module.exports = { createHoldTracker };
