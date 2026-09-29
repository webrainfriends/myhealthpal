const test = require('node:test');
const assert = require('node:assert/strict');
const { templateSummary } = require('../src/workout/summaryProvider');

const metrics = {
  exerciseName: 'Squat', isHold: false, plannedSets: 3, completedSets: 3, plannedReps: 36, validReps: 30,
  partialReps: 4, invalidReps: 1, totalHoldSeconds: 0, targetRestSeconds: 60, avgRestSeconds: 74,
  topFormIssues: [{ rule: 'KNEE_VALGUS', severity: 'minor', count: 3 }],
};

test('template summary only states measured facts', () => {
  const t = templateSummary(metrics);
  assert.match(t, /30 valid Squat rep\(s\) of 36 planned/);
  assert.match(t, /KNEE_VALGUS \(3x\)/);
  assert.match(t, /74s against a 60s target/);
  assert.match(t, /not a substitute for a qualified trainer/);
});
