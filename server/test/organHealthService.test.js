const test = require('node:test');
const assert = require('node:assert/strict');
const { ORGAN_GROUPS, buildOrganSummaries, determineResultStatus } = require('../src/services/organHealthService');

test('no registry category is claimed by more than one organ group', () => {
  const mapped = ORGAN_GROUPS.flatMap((g) => g.categories);
  const seen = new Set();
  for (const category of mapped) {
    assert.equal(seen.has(category), false, `"${category}" is mapped to more than one organ group`);
    seen.add(category);
  }
});

test('every currently-carded category maps to its expected organ group', () => {
  // Some registry categories (infectious_disease, hormones, immunology,
  // tumor_markers) are deliberately uncarded - present in the data and
  // still reachable via reports/timeline/chat, just with no dashboard
  // card of their own. This only checks the categories that ARE meant to
  // have a card.
  const EXPECTED = {
    diabetes: 'diabetes',
    lipids: 'heart',
    cardiac: 'heart',
    hematology: 'blood',
    kidney: 'kidney',
    electrolytes: 'kidney',
    liver: 'liver_pancreas',
    pancreas: 'liver_pancreas',
    metabolic: 'metabolism',
    thyroid: 'metabolism',
    vitamins: 'vitamins',
  };
  for (const [category, expectedKey] of Object.entries(EXPECTED)) {
    const group = ORGAN_GROUPS.find((g) => g.categories.includes(category));
    assert.ok(group, `"${category}" should map to some organ group`);
    assert.equal(group.key, expectedKey, `"${category}" should map to "${expectedKey}"`);
  }
});

test('activity, brain, and bones have no registry category yet and always report no_data', () => {
  for (const key of ['activity', 'brain', 'bones']) {
    const group = ORGAN_GROUPS.find((g) => g.key === key);
    assert.deepEqual(group.categories, []);
  }
  const summaries = buildOrganSummaries([]);
  for (const key of ['activity', 'brain', 'bones']) {
    const organ = summaries.find((s) => s.key === key);
    assert.equal(organ.status, 'no_data');
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

  assert.equal(buildOrganSummaries(makeRows(9, 1)).find((s) => s.key === 'kidney').status, 'good'); // 90%
  assert.equal(buildOrganSummaries(makeRows(7, 3)).find((s) => s.key === 'kidney').status, 'watch'); // 70%
  assert.equal(buildOrganSummaries(makeRows(6, 4)).find((s) => s.key === 'kidney').status, 'attention'); // 60%
});

test('kidney group merges the kidney and electrolytes categories', () => {
  const rows = [
    { code: 'creatinine', displayName: 'Creatinine', category: 'kidney', statusFlag: 'Normal', numericValue: 1 },
    { code: 'sodium', displayName: 'Sodium', category: 'electrolytes', statusFlag: 'Normal', numericValue: 140 },
  ];
  const kidney = buildOrganSummaries(rows).find((s) => s.key === 'kidney');
  assert.equal(kidney.trackedCount, 2);
  assert.deepEqual(
    kidney.parameters.map((p) => p.code).sort(),
    ['creatinine', 'sodium']
  );
});
