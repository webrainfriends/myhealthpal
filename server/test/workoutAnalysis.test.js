const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../src/workout/analysis');

const rep = (o) => ({ classification: 'valid', range_of_motion_score: 0.9, ...o });

test('averageTempo and tempoAdherence compare actual phases with the plan', () => {
  const reps = [rep({ eccentric_ms: 2300, hold_ms: 400, concentric_ms: 1500 }), rep({ eccentric_ms: 2700, hold_ms: 600, concentric_ms: 1700 })];
  assert.deepEqual(a.averageTempo(reps), { downSeconds: 2.5, pauseSeconds: 0.5, upSeconds: 1.6, reps: 2 });
  const adherence = a.tempoAdherence(reps, { down: 3, pause: 0, up: 2 }); // pause target 0 ignored
  assert.ok(adherence > 0.7 && adherence < 0.9, String(adherence));
  assert.equal(a.tempoAdherence(reps, null), null);
  assert.equal(a.averageTempo([rep({})]), null);
});

test('symmetry averages measured scores and is null when unmeasured', () => {
  assert.equal(a.symmetry([rep({ symmetry_score: 0.9 }), rep({ symmetry_score: 0.7 })]), 0.8);
  assert.equal(a.symmetry([rep({})]), null);
});

test('qualityTrend flags fatigue when range of motion falls by the last set', () => {
  const sets = new Map([
    [1, [rep({ range_of_motion_score: 1 }), rep({ range_of_motion_score: 0.95 })]],
    [2, [rep({ range_of_motion_score: 0.8, classification: 'partial' }), rep({ range_of_motion_score: 0.75, classification: 'partial' })]],
  ]);
  const t = a.qualityTrend(sets);
  assert.equal(t.fatigueDetected, true);
  assert.ok(t.romChange < 0);
  assert.equal(a.qualityTrend(new Map([[1, [rep({})]]])), null);
});

test('compareSessions reports deltas and null without a previous session', () => {
  assert.equal(a.compareSessions({ validReps: 10 }, null), null);
  const c = a.compareSessions({ validReps: 12, rom: 0.9, validRatio: 0.9 }, { completedAt: 'x', validReps: 10, rom: 0.8, validRatio: 0.8 });
  assert.equal(c.validReps.change, 2);
  assert.equal(c.rom.change, 0.1);
});
