const test = require('node:test');
const assert = require('node:assert/strict');
const { ORGAN_GROUPS, buildOrganSummaries, determineResultStatus } = require('../src/services/organHealthService');

test('every registry category maps to exactly one organ group', () => {
  const REGISTRY_CATEGORIES = [
    'hematology',
    'metabolic',
    'lipids',
    'electrolytes',
    'kidney',
    'liver',
    'thyroid',
    'vitamins',
    'infectious_disease',
  ];
  const mapped = ORGAN_GROUPS.flatMap((g) => g.categories);
  for (const category of REGISTRY_CATEGORIES) {
    assert.equal(mapped.filter((c) => c === category).length, 1, `"${category}" should map to exactly one organ group`);
  }
});

test('determineResultStatus trusts an explicit status_flag over the range', () => {
  assert.equal(determineResultStatus({ statusFlag: 'Normal', numericValue: 999, referenceRangeRaw: '1-5' }), 'normal');
  assert.equal(determineResultStatus({ statusFlag: 'High', numericValue: 3, referenceRangeRaw: '1-5' }), 'abnormal');
  assert.equal(determineResultStatus({ statusFlag: 'H' }), 'abnormal');
  assert.equal(determineResultStatus({ statusFlag: 'N' }), 'normal');
});

test('determineResultStatus falls back to the printed reference range when there is no flag', () => {
  assert.equal(determineResultStatus({ numericValue: 13.7, referenceRangeRaw: '13-17' }), 'normal');
  assert.equal(determineResultStatus({ numericValue: 20, referenceRangeRaw: '13-17' }), 'abnormal');
  assert.equal(determineResultStatus({ normalizedValue: 5.6, referenceRangeRaw: '3.5-5.1' }), 'abnormal');
});

test('determineResultStatus is "unknown" (never guessed) with neither a flag nor a parseable range', () => {
  assert.equal(determineResultStatus({ qualitativeValue: 'Not Detected' }), 'unknown');
  assert.equal(determineResultStatus({ numericValue: 13.7, referenceRangeRaw: null }), 'unknown');
});

test('buildOrganSummaries scores an organ by % of determinable results that are normal, ignoring unknowns', () => {
  const rows = [
    { code: 'ldl', displayName: 'LDL Cholesterol', category: 'lipids', statusFlag: 'High', numericValue: 160 },
    { code: 'hdl', displayName: 'HDL Cholesterol', category: 'lipids', statusFlag: 'Normal', numericValue: 55 },
    { code: 'trig', displayName: 'Triglycerides', category: 'lipids', statusFlag: 'Normal', numericValue: 120 },
    { code: 'unk', displayName: 'Some Unscored Lipid Marker', category: 'lipids' }, // no flag, no range -> unknown
  ];

  const summaries = buildOrganSummaries(rows);
  const heart = summaries.find((s) => s.key === 'heart');

  assert.equal(heart.trackedCount, 4);
  assert.equal(heart.normalCount, 2);
  assert.equal(heart.attentionCount, 1);
  assert.equal(heart.scorePercent, 67); // 2 of 3 determinable results normal
  assert.equal(heart.status, 'attention'); // 67% is below the 70% "watch" threshold
  assert.equal(heart.statusLabel, 'Needs attention');
});

test('an organ group with no tracked parameters reports no_data rather than a fabricated score', () => {
  const summaries = buildOrganSummaries([]);
  for (const organ of summaries) {
    assert.equal(organ.scorePercent, null);
    assert.equal(organ.status, 'no_data');
    assert.equal(organ.trackedCount, 0);
  }
});

test('score thresholds: >=90 good, 70-89 watch, <70 attention', () => {
  const makeRows = (normal, abnormal) => {
    const rows = [];
    for (let i = 0; i < normal; i += 1) {
      rows.push({ code: `n${i}`, displayName: `Normal ${i}`, category: 'kidney', statusFlag: 'Normal', numericValue: 1 });
    }
    for (let i = 0; i < abnormal; i += 1) {
      rows.push({ code: `a${i}`, displayName: `Abnormal ${i}`, category: 'kidney', statusFlag: 'High', numericValue: 1 });
    }
    return rows;
  };

  assert.equal(buildOrganSummaries(makeRows(9, 1)).find((s) => s.key === 'kidneys').status, 'good'); // 90%
  assert.equal(buildOrganSummaries(makeRows(7, 3)).find((s) => s.key === 'kidneys').status, 'watch'); // 70%
  assert.equal(buildOrganSummaries(makeRows(6, 4)).find((s) => s.key === 'kidneys').status, 'attention'); // 60%
});

test('kidneys group merges the kidney and electrolytes categories', () => {
  const rows = [
    { code: 'creatinine', displayName: 'Creatinine', category: 'kidney', statusFlag: 'Normal', numericValue: 1 },
    { code: 'sodium', displayName: 'Sodium', category: 'electrolytes', statusFlag: 'Normal', numericValue: 140 },
  ];
  const kidneys = buildOrganSummaries(rows).find((s) => s.key === 'kidneys');
  assert.equal(kidneys.trackedCount, 2);
  assert.deepEqual(
    kidneys.parameters.map((p) => p.code).sort(),
    ['creatinine', 'sodium']
  );
});
