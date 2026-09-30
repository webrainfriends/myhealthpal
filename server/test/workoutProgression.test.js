const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestNext, buildAnalytics } = require('../src/workout/progression');

const s = (o) => ({ targetSets: 3, targetReps: 10, targetHoldSeconds: null, targetRestSeconds: 60, isHold: false, plannedRepsAchieved: 1, correctFormRatio: 0.9, fatigueDetected: false, validReps: 30, bestSetReps: 10, completedAt: '2026-09-01', ...o });

test('no history -> no suggestion', () => assert.equal(suggestNext([]), null));

test('full completion with good form and no fatigue progresses by two reps', () => {
  const r = suggestNext([s({})]);
  assert.equal(r.action, 'progress');
  assert.equal(r.targets.reps, 12);
  assert.match(r.reason, /100%/);
});

test('poor form or repeated fatigue deloads: same targets, more rest', () => {
  const poor = suggestNext([s({ correctFormRatio: 0.6 })]);
  assert.equal(poor.action, 'deload');
  assert.equal(poor.targets.reps, 10);
  assert.equal(poor.targets.restSeconds, 75);
  const tired = suggestNext([s({ fatigueDetected: true }), s({ fatigueDetected: true })]);
  assert.equal(tired.action, 'deload');
  assert.equal(suggestNext([s({ fatigueDetected: true }), s({})]).action, 'maintain'); // a single fatigued session only blocks progression
});

test('under-completing repeats the targets', () => {
  const r = suggestNext([s({ plannedRepsAchieved: 0.8 })]);
  assert.equal(r.action, 'maintain');
  assert.equal(r.targets.reps, 10);
});

test('caps: high reps add a set, holds add seconds up to the cap, top of range maintains', () => {
  const sets = suggestNext([s({ targetReps: 30 })]);
  assert.deepEqual([sets.targets.sets, sets.targets.reps], [4, 24]);
  const top = suggestNext([s({ targetReps: 30, targetSets: 5 })]);
  assert.equal(top.action, 'maintain');
  const hold = suggestNext([s({ isHold: true, targetReps: null, targetHoldSeconds: 30 })]);
  assert.equal(hold.targets.holdSeconds, 35);
  assert.equal(hold.targets.reps, null);
  assert.equal(suggestNext([s({ isHold: true, targetReps: null, targetHoldSeconds: 120 })]).action, 'maintain');
});

test('analytics summarises volume, best set and direction of travel', () => {
  const sessions = [40, 36, 30, 28].map((v, i) => s({ validReps: v, bestSetReps: v / 3, completedAt: `2026-09-0${4 - i}` })); // newest first
  const a = buildAnalytics(sessions);
  assert.equal(a.sessions, 4);
  assert.equal(a.totalValidReps, 134);
  assert.equal(a.direction, 'up');
  assert.ok(a.bestSetReps > 13);
  assert.equal(buildAnalytics(sessions.slice(0, 2)).direction, null);
  assert.equal(buildAnalytics([s({ validReps: 20 }), s({ validReps: 20 }), s({ validReps: 20 }), s({ validReps: 20 })]).direction, 'steady');
});
