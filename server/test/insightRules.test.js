const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectNewResult,
  detectChangeFromPrevious,
  detectSustainedTrend,
  detectNewAbnormalFlag,
  detectRepeatedAbnormal,
} = require('../src/insights/insightRules');

function measurement(overrides) {
  return {
    measurementId: 'm-default',
    reportId: 'r-default',
    parameterDisplayName: 'Hemoglobin A1c',
    numericValue: null,
    normalizedValue: null,
    normalizedUnit: '%',
    rawUnit: '%',
    qualitativeValue: null,
    statusFlag: 'Normal',
    effectiveDate: '2026-01-01',
    ...overrides,
  };
}

test('detectNewResult fires only when there is no prior history', () => {
  const current = measurement({ measurementId: 'm1', normalizedValue: 5.6 });
  assert.ok(detectNewResult(current, []));
  assert.equal(detectNewResult(current, [measurement({ measurementId: 'm0' })]), null);
});

test('detectChangeFromPrevious ignores small moves, fires on a large one', () => {
  const prior = measurement({ measurementId: 'm1', normalizedValue: 100, effectiveDate: '2026-01-01' });
  const smallMove = measurement({ measurementId: 'm2', normalizedValue: 105, effectiveDate: '2026-02-01' });
  const bigMove = measurement({ measurementId: 'm3', normalizedValue: 140, effectiveDate: '2026-02-01' });

  assert.equal(detectChangeFromPrevious(smallMove, [prior]), null);

  const candidate = detectChangeFromPrevious(bigMove, [prior]);
  assert.ok(candidate);
  assert.equal(candidate.type, 'change_from_previous');
  assert.equal(candidate.templateData.direction, 'higher');
  assert.equal(candidate.templateData.pctChange, 40);
  assert.equal(candidate.severity, 'attention');
  assert.deepEqual(candidate.evidenceMeasurementIds, ['m1', 'm3']);
});

test('detectChangeFromPrevious fires on a qualitative flip even without numbers', () => {
  const prior = measurement({ measurementId: 'm1', qualitativeValue: 'Negative' });
  const current = measurement({ measurementId: 'm2', qualitativeValue: 'Positive' });
  const candidate = detectChangeFromPrevious(current, [prior]);
  assert.ok(candidate);
  assert.equal(candidate.templateData.qualitative, true);
});

test('detectSustainedTrend requires a monotonic 3-point window', () => {
  const rising = [
    measurement({ measurementId: 'm1', normalizedValue: 5.0, effectiveDate: '2026-01-01' }),
    measurement({ measurementId: 'm2', normalizedValue: 5.5, effectiveDate: '2026-02-01' }),
  ];
  const current = measurement({ measurementId: 'm3', normalizedValue: 6.0, effectiveDate: '2026-03-01' });
  const candidate = detectSustainedTrend(current, rising);
  assert.ok(candidate);
  assert.equal(candidate.templateData.direction, 'rising');
  assert.equal(candidate.evidenceMeasurementIds.length, 3);

  const nonMonotonic = [
    measurement({ measurementId: 'm1', normalizedValue: 5.0 }),
    measurement({ measurementId: 'm2', normalizedValue: 4.5 }),
  ];
  assert.equal(detectSustainedTrend(current, nonMonotonic), null);
});

test('detectNewAbnormalFlag fires only on the transition into abnormal', () => {
  const wasNormal = [measurement({ measurementId: 'm1', statusFlag: 'Normal' })];
  const current = measurement({ measurementId: 'm2', statusFlag: 'High' });
  assert.ok(detectNewAbnormalFlag(current, wasNormal));

  const wasAlreadyAbnormal = [measurement({ measurementId: 'm1', statusFlag: 'High' })];
  assert.equal(detectNewAbnormalFlag(current, wasAlreadyAbnormal), null);
});

test('detectRepeatedAbnormal requires every point in the window to be flagged', () => {
  const allAbnormal = [
    measurement({ measurementId: 'm1', statusFlag: 'High' }),
    measurement({ measurementId: 'm2', statusFlag: 'High' }),
  ];
  const current = measurement({ measurementId: 'm3', statusFlag: 'High' });
  assert.ok(detectRepeatedAbnormal(current, allAbnormal));

  const mixed = [
    measurement({ measurementId: 'm1', statusFlag: 'Normal' }),
    measurement({ measurementId: 'm2', statusFlag: 'High' }),
  ];
  assert.equal(detectRepeatedAbnormal(current, mixed), null);
});
