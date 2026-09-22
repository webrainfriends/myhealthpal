const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeMetrics,
  computeFlags,
  computeConsiderations,
  buildPatternTips,
  buildConsiderationTips,
} = require('../src/diet/dietInsightService');

function entry(overrides) {
  return {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
    meal_type: 'lunch',
    consumed_at: '2026-06-15T12:00:00Z',
    ...overrides,
  };
}

function medication(overrides) {
  return { id: 'med-1', name: 'Metformin', generic_name: 'metformin', brand_name: null, status: 'active', ...overrides };
}

test('computeMetrics averages calories/macros per logged day, not per entry', () => {
  const entries = [
    entry({ consumed_at: '2026-06-14T08:00:00Z', calories: 300, meal_type: 'breakfast' }),
    entry({ consumed_at: '2026-06-14T13:00:00Z', calories: 500, meal_type: 'lunch' }),
    entry({ consumed_at: '2026-06-15T13:00:00Z', calories: 400, meal_type: 'lunch' }),
  ];
  const metrics = computeMetrics(entries, 14);
  assert.equal(metrics.loggedDayCount, 2);
  assert.equal(metrics.entriesAnalyzedCount, 3);
  // (300+500)/1 day + 400/1 day, averaged across 2 days -> (800+400)/2 = 600
  assert.equal(metrics.avgDailyCalories, 600);
});

test('computeMetrics counts late-night entries from supper and small-hours snacks only', () => {
  const entries = [
    entry({ consumed_at: '2026-06-14T21:45:00Z', meal_type: 'supper' }),
    entry({ consumed_at: '2026-06-14T02:00:00Z', meal_type: 'snack' }),
    entry({ consumed_at: '2026-06-14T16:30:00Z', meal_type: 'snack' }), // afternoon snack, not late-night
  ];
  const metrics = computeMetrics(entries, 14);
  assert.equal(metrics.lateNightEntryCount, 2);
});

test('computeMetrics only judges skipped breakfast once enough days are logged', () => {
  const fewDays = [entry({ consumed_at: '2026-06-14T13:00:00Z' }), entry({ consumed_at: '2026-06-15T13:00:00Z' })];
  assert.equal(computeMetrics(fewDays, 14).breakfastSkipRatio, null);

  const manyDaysNoBreakfast = Array.from({ length: 5 }, (_, i) =>
    entry({ consumed_at: `2026-06-${10 + i}T13:00:00Z`, meal_type: 'lunch' })
  );
  const metrics = computeMetrics(manyDaysNoBreakfast, 14);
  assert.equal(metrics.breakfastSkipRatio, 1);
});

test('computeFlags fires highSodium when most logged days exceed the daily limit', () => {
  const entries = [
    entry({ consumed_at: '2026-06-14T13:00:00Z', sodium_mg: 3000 }),
    entry({ consumed_at: '2026-06-15T13:00:00Z', sodium_mg: 500 }),
  ];
  const metrics = computeMetrics(entries, 14);
  const flags = computeFlags(metrics);
  assert.equal(flags.highSodium, true); // 1 of 2 days = 50% >= 40% threshold
});

test('computeFlags does not fire lowFiber with too little logging history', () => {
  const entries = [entry({ consumed_at: '2026-06-14T13:00:00Z', fiber_g: 2 })];
  const flags = computeFlags(computeMetrics(entries, 14));
  assert.equal(flags.lowFiber, false);
});

test('computeConsiderations matches an active diabetes medication to the "diabetes" key', () => {
  const considerations = computeConsiderations([medication()], []);
  assert.equal(considerations.length, 1);
  assert.equal(considerations[0].key, 'diabetes');
  assert.deepEqual(considerations[0].medicationNames, ['Metformin']);
});

test('computeConsiderations merges a medication and a lab flag onto the same key', () => {
  const considerations = computeConsiderations(
    [medication({ name: 'Hydrochlorothiazide', generic_name: 'hydrochlorothiazide' })],
    [{ parameter_code: 'sodium', parameter_display_name: 'Sodium', status_flag: 'Low' }]
  );
  assert.equal(considerations.length, 1);
  assert.equal(considerations[0].key, 'bloodPressure');
  assert.equal(considerations[0].medicationNames.length, 1);
  assert.equal(considerations[0].labFindings.length, 1);
});

test('computeConsiderations ignores medications with no dietary-relevant category match', () => {
  const considerations = computeConsiderations([medication({ name: 'Azithromycin', generic_name: 'azithromycin' })], []);
  assert.equal(considerations.length, 0);
});

test('buildPatternTips escalates severity when a matching medical consideration exists', () => {
  const metrics = computeMetrics(
    [
      entry({ consumed_at: '2026-06-14T13:00:00Z', sodium_mg: 3000 }),
      entry({ consumed_at: '2026-06-15T13:00:00Z', sodium_mg: 2800 }),
    ],
    14
  );
  const flags = computeFlags(metrics);

  const withoutConsideration = buildPatternTips(metrics, flags, new Set());
  const withConsideration = buildPatternTips(metrics, flags, new Set(['bloodPressure']));

  assert.equal(withoutConsideration.find((t) => t.type === 'high_sodium_intake').severity, 'attention');
  assert.equal(withConsideration.find((t) => t.type === 'high_sodium_intake').severity, 'important');
});

test('buildPatternTips detail text only cites numbers present in its own template data', () => {
  const metrics = computeMetrics(
    [entry({ consumed_at: '2026-06-14T13:00:00Z', fiber_g: 2 }), entry({ consumed_at: '2026-06-15T13:00:00Z', fiber_g: 3 }), entry({ consumed_at: '2026-06-16T13:00:00Z', fiber_g: 1 })],
    14
  );
  const flags = computeFlags(metrics);
  const tips = buildPatternTips(metrics, flags, new Set());
  const fiberTip = tips.find((t) => t.type === 'low_fiber_intake');
  assert.ok(fiberTip);
  const numbersInText = fiberTip.heuristicDetail.match(/\d+(\.\d+)?/g).map(Number);
  const allowed = Object.values(fiberTip.templateData);
  for (const n of numbersInText) {
    assert.ok(allowed.some((a) => Math.round(a) === Math.round(n)), `unexpected number ${n} not in template data`);
  }
});

test('buildConsiderationTips cites the medication name(s) that produced the consideration', () => {
  const considerations = computeConsiderations([medication()], []);
  const tips = buildConsiderationTips(considerations);
  assert.equal(tips.length, 1);
  assert.match(tips[0].heuristicDetail, /Metformin/);
});
