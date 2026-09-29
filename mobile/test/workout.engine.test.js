const test = require('node:test');
const assert = require('node:assert/strict');
const { getExercise, createRepCounter, createHoldTracker, analyzeForm, createCoachThrottle, missingLandmarks } = require('../src/workout/engine');

const rad = (d) => (d * Math.PI) / 180;

// Both legs with the given knee angle (degrees).
function legs(kneeAngle, c = 0.9) {
  const lm = {};
  for (const s of ['LEFT', 'RIGHT']) {
    lm[`${s}_HIP`] = { x: 0, y: -1, c };
    lm[`${s}_KNEE`] = { x: 0, y: 0, c };
    lm[`${s}_ANKLE`] = { x: Math.sin(rad(kneeAngle)), y: -Math.cos(rad(kneeAngle)), c };
  }
  return lm;
}

// Drives the counter through a sequence of angles at 100ms per frame.
function run(counter, angles, c) {
  const reps = [];
  angles.forEach((a, i) => {
    const r = counter.update(legs(a, c), i * 100).rep;
    if (r) reps.push(r);
  });
  return reps;
}

const ramp = (from, to, steps) => Array.from({ length: steps }, (_, i) => from + ((to - from) * (i + 1)) / steps);
const cycle = (bottom) => [...ramp(175, bottom, 8), ...ramp(bottom, 175, 8)];
const counter = () => createRepCounter(getExercise('squat'), { smoothing: 1 });

test('a full squat cycle counts one valid rep with full ROM', () => {
  const reps = run(counter(), [175, ...cycle(85)]);
  assert.equal(reps.length, 1);
  assert.equal(reps[0].classification, 'valid');
  assert.equal(reps[0].rangeOfMotionScore, 1);
});

test('a shallow-but-real squat is a partial rep, not a valid one', () => {
  const reps = run(counter(), [175, ...cycle(120)]);
  assert.deepEqual(reps.map((r) => r.classification), ['partial']);
  assert.ok(reps[0].rangeOfMotionScore < 1);
});

test('tiny wobble is ignored as a false movement', () => {
  assert.equal(run(counter(), [175, ...cycle(160)]).length, 0);
});

test('three cycles count three reps and totals track classifications', () => {
  const c = counter();
  const reps = run(c, [175, ...cycle(85), ...cycle(85), ...cycle(125)]);
  assert.deepEqual(reps.map((r) => r.classification), ['valid', 'valid', 'partial']);
  assert.deepEqual(c.totals, { valid: 2, partial: 1, invalid: 0 });
});

test('low-confidence frames pause counting and never advance a rep', () => {
  const c = counter();
  assert.equal(run(c, [175, ...cycle(85)], 0.2).length, 0);
  assert.equal(c.paused, true);
});

test('losing the pose mid-rep beyond the interrupt window yields an invalid rep', () => {
  const c = counter();
  [175, 150, 110].forEach((a, i) => c.update(legs(a), i * 100));
  const out = c.update({}, 5000);
  assert.equal(out.rep.classification, 'invalid');
  assert.equal(out.rep.issue, 'interrupted');
});

test('plank hold only accrues while the body line is in spec', () => {
  const ex = getExercise('plank');
  const t = createHoldTracker(ex);
  const body = (hipAngle) => {
    const lm = {};
    for (const s of ['LEFT', 'RIGHT']) {
      lm[`${s}_SHOULDER`] = { x: 0, y: 0, c: 0.9 };
      lm[`${s}_HIP`] = { x: 1, y: 0, c: 0.9 };
      lm[`${s}_ANKLE`] = { x: 1 + Math.cos(rad(180 - hipAngle)), y: Math.sin(rad(180 - hipAngle)), c: 0.9 };
    }
    return lm;
  };
  for (let i = 0; i <= 30; i += 1) t.update(body(175), i * 100); // 3s good
  for (let i = 31; i <= 60; i += 1) t.update(body(140), i * 100); // 3s sagging
  assert.equal(t.heldSeconds, 3);
});

test('form analyzer reports the measured value, and stays silent at low confidence', () => {
  const ex = getExercise('squat');
  const lean = {};
  for (const s of ['LEFT', 'RIGHT']) {
    lean[`${s}_HIP`] = { x: 0, y: 0, c: 0.9 };
    lean[`${s}_SHOULDER`] = { x: 1, y: -1, c: 0.9 }; // 45deg -> fine
  }
  assert.equal(analyzeForm(ex, lean, 'bottom').length, 0);
  for (const s of ['LEFT', 'RIGHT']) lean[`${s}_SHOULDER`] = { x: 1, y: -0.3, c: 0.9 }; // ~73deg
  const events = analyzeForm(ex, lean, 'bottom');
  assert.equal(events[0].ruleCode, 'TORSO_LEAN');
  assert.ok(events[0].measuredValue > 55);
  for (const s of ['LEFT', 'RIGHT']) lean[`${s}_SHOULDER`].c = 0.3;
  assert.equal(analyzeForm(ex, lean, 'bottom').length, 0);
});

test('coach throttle enforces levels and per-rule rate limits', () => {
  const t = createCoachThrottle({ level: 'full', globalGapMs: 4000, perCodeGapMs: 15000 });
  assert.equal(t.shouldSpeakCue('TORSO_LEAN', 'minor', 0), true);
  assert.equal(t.shouldSpeakCue('TORSO_LEAN', 'minor', 1000), false);
  assert.equal(t.shouldSpeakCue('BODY_LINE', 'minor', 5000), true);
  assert.equal(t.shouldSpeakCue('TORSO_LEAN', 'minor', 10000), false);
  assert.equal(t.shouldSpeakCue('TORSO_LEAN', 'minor', 20000), true);
  t.setLevel('minimal');
  assert.equal(t.shouldSpeakCue('X', 'minor', 99999), false);
  assert.equal(t.shouldSpeakCue('X', 'significant', 99999), true);
  t.setLevel('count');
  assert.equal(t.shouldSpeakCue('Y', 'reposition', 199999), false);
  assert.equal(t.shouldAnnounceCount(), true);
  t.setLevel('off');
  assert.equal(t.shouldAnnounceCount(), false);
});

test('missingLandmarks accepts either side but flags absent joints', () => {
  const lm = { LEFT_HIP: { x: 0, y: 0, c: 0.9 }, RIGHT_KNEE: { x: 0, y: 0, c: 0.9 }, LEFT_ANKLE: { x: 0, y: 0, c: 0.2 } };
  assert.deepEqual(missingLandmarks(lm, getExercise('squat').required, 0.5), ['ANKLE']);
});

const { createWorkoutRunner } = require('../src/workout/engine');

test('workout runner: completes sets on target valid reps, rests, then finishes', () => {
  const ex = getExercise('squat');
  const runner = createWorkoutRunner({ exercise: ex, targetSets: 2, targetReps: 2, targetRestSeconds: 30, options: { smoothing: 1 } });
  let t = 0;
  const feedAngles = (angles) => angles.forEach((a) => { runner.feed(legs(a), t); t += 100; });

  feedAngles([175, ...cycle(85), ...cycle(120), ...cycle(85)]); // valid, partial, valid
  assert.equal(runner.phase, 'rest');
  assert.equal(runner.sets.length, 1);
  assert.equal(runner.sets[0].reps.length, 3);
  assert.equal(runner.setNumber, 2);

  // Frames during rest are ignored.
  feedAngles(cycle(85));
  assert.equal(runner.sets.length, 1);

  t += 40000;
  runner.startNextSet(t);
  assert.ok(runner.sets[0].restSecondsAfter >= 30 && runner.sets[0].restSecondsAfter <= 45);
  assert.equal(runner.phase, 'active');

  feedAngles([175, ...cycle(85), ...cycle(85)]);
  assert.equal(runner.phase, 'done');
  assert.equal(runner.sets.length, 2);
  assert.equal(runner.sets[1].reps.filter((r) => r.classification === 'valid').length, 2);
  assert.ok(runner.activeSeconds > 0);
});

test('workout runner: ending early keeps a set that has activity', () => {
  const runner = createWorkoutRunner({ exercise: getExercise('squat'), targetSets: 3, targetReps: 10, options: { smoothing: 1 } });
  let t = 0;
  [175, ...cycle(85)].forEach((a) => { runner.feed(legs(a), t); t += 100; });
  const sets = runner.finish(t);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].reps.length, 1);
});

test('valid reps carry tempo phases and (with both sides) a symmetry score', () => {
  const c = createRepCounter(getExercise('squat'), { smoothing: 1 });
  const uneven = (a) => {
    const lm = legs(a);
    lm.RIGHT_ANKLE = { x: Math.sin(rad(Math.max(a, 105))), y: -Math.cos(rad(Math.max(a, 105))), c: 0.9 }; // right knee bends less
    return lm;
  };
  // 100ms frames: descend 8 frames, hold 5 frames at the bottom, ascend 8.
  const angles = [175, ...ramp(175, 85, 8), 85, 85, 85, 85, 85, ...ramp(85, 175, 8)];
  let rep = null;
  angles.forEach((a, i) => { const r = c.update(uneven(a), i * 100).rep; if (r) rep = r; });
  assert.equal(rep.classification, 'valid');
  assert.ok(rep.eccentricMs > 0 && rep.concentricMs > 0 && rep.holdMs >= 0);
  assert.ok(rep.symmetryScore > 0 && rep.symmetryScore < 1);
});

test('runner cues a rep lowered much faster than the planned tempo', () => {
  const runner = createWorkoutRunner({ exercise: getExercise('squat'), targetSets: 1, targetReps: 5, tempo: { down: 3, pause: 0, up: 2 }, options: { smoothing: 1 } });
  let t = 0;
  const cues = [];
  [175, ...cycle(85)].forEach((a) => { cues.push(...runner.feed(legs(a), t).events.filter((e) => e.type === 'cue')); t += 100; });
  assert.ok(cues.some((c) => c.ruleCode === 'TEMPO_DOWN_FAST'));
});

const overlay = require('../src/workout/overlay');

test('overlay picks the sampled frame for a playback time and builds bone segments', () => {
  const frames = Array.from({ length: 10 }, (_, i) => ({ t: i * 200, lm: { LEFT_HIP: [0.5, 0.5], LEFT_KNEE: [0.5, 0.7], LEFT_ANKLE: [0.7, 0.7 + i * 0.001] } }));
  assert.equal(overlay.frameAt(frames, 5, 1000), frames[5]);
  assert.equal(overlay.frameAt(frames, 5, 99999), null);
  assert.equal(overlay.frameAt([], 5, 0), null);
  const segs = overlay.segments(frames[0]);
  assert.equal(segs.length, 2); // hip-knee and knee-ankle only
  assert.ok(Math.abs(overlay.jointAngle(frames[0], ['LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE']) - 90) < 2);
  const evs = [{ timestampMs: 1000, ruleCode: 'A' }, { timestampMs: 9000, ruleCode: 'B' }];
  assert.deepEqual(overlay.activeEvents(evs, 1200).map((e) => e.ruleCode), ['A']);
});
