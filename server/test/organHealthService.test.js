const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ORGAN_GROUPS,
  buildOrganSummaries,
  buildCardSummaries,
  determineResultStatus,
} = require('../src/services/organHealthService');

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
    urine: 'kidney',
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

test('activity has no organ group at all (tracked separately, never scored against a range)', () => {
  assert.equal(
    ORGAN_GROUPS.find((g) => g.key === 'activity'),
    undefined
  );
});

test('brain and bones have no registry category yet and always report no_data', () => {
  for (const key of ['brain', 'bones']) {
    const group = ORGAN_GROUPS.find((g) => g.key === key);
    assert.deepEqual(group.categories, []);
  }
  const summaries = buildOrganSummaries([]);
  for (const key of ['brain', 'bones']) {
    const organ = summaries.find((s) => s.key === key);
    assert.equal(organ.status, 'no_data');
  }
});

test('every organ card - even an empty one like Brain - names what tests would feed it', () => {
  const summaries = buildOrganSummaries([]);
  for (const organ of summaries) {
    assert.ok(Array.isArray(organ.suggestedTests) && organ.suggestedTests.length > 0, `${organ.key} has no suggestedTests`);
  }
  const brain = summaries.find((s) => s.key === 'brain');
  assert.ok(brain.suggestedTests.includes('Vitamin B12'));
  // Brain/bones' suggested labs are never a substitute for the actual
  // brain/bone-specific test (cognitive screening, a DEXA scan) - that
  // must be called out explicitly, not implied by the lab list alone.
  assert.match(brain.note, /MRI|cognitive/i);
  const bones = summaries.find((s) => s.key === 'bones');
  assert.match(bones.note, /DEXA/i);
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

test('determineResultStatus falls through to the value/range check on an unrecognized status_flag, instead of guessing abnormal', () => {
  // Regression test: a placeholder dash, "See Note", a trailing period, or
  // any other flag text this app doesn't recognize used to be treated the
  // same as an explicit "High"/"Low" - silently marking an in-range result
  // as out-of-range. It must now behave exactly like no flag at all.
  const inRange = { statusFlag: '-', numericValue: 20, referenceRangeRaw: '5-35' };
  assert.equal(determineResultStatus(inRange), 'normal');

  const alsoInRange = { statusFlag: 'See Note', numericValue: 4.02, referenceRangeRaw: '3.5-5.2' };
  assert.equal(determineResultStatus(alsoInRange), 'normal');

  const punctuationNormal = { statusFlag: 'Normal.', numericValue: 22, referenceRangeRaw: '5-40' };
  assert.equal(determineResultStatus(punctuationNormal), 'normal');

  // An unrecognized flag on a genuinely out-of-range value still correctly
  // reads as abnormal - falling through to the range check, not the flag,
  // still catches it.
  const genuinelyAbnormal = { statusFlag: 'xyz', numericValue: 135, referenceRangeRaw: '53-128' };
  assert.equal(determineResultStatus(genuinelyAbnormal), 'abnormal');
});

test('determineResultStatus recognizes common normal/abnormal flag synonyms beyond Normal/High/Low', () => {
  assert.equal(determineResultStatus({ statusFlag: 'WNL', numericValue: 999, referenceRangeRaw: '1-5' }), 'normal');
  assert.equal(determineResultStatus({ statusFlag: 'Unremarkable', numericValue: 999, referenceRangeRaw: '1-5' }), 'normal');
  assert.equal(determineResultStatus({ statusFlag: 'Critical', numericValue: 3, referenceRangeRaw: '1-5' }), 'abnormal');
  assert.equal(determineResultStatus({ statusFlag: 'Positive', numericValue: 3, referenceRangeRaw: '1-5' }), 'abnormal');
});

test('determineResultStatus is "unknown" (never guessed) with neither a flag nor a parseable range', () => {
  assert.equal(determineResultStatus({ qualitativeValue: 'Not Detected' }), 'unknown');
  assert.equal(determineResultStatus({ numericValue: 13.7, referenceRangeRaw: null }), 'unknown');
});

test('determineResultStatus falls back to the standard range when the report printed no usable flag/range', () => {
  const hba1cStandard = { range_low: 4.0, range_high: 5.6 };
  // A multi-tier diagnostic band like HbA1c's isn't a plain "min-max", so
  // the regex-based printed-range parse can't use it - this is exactly the
  // shape a real report produces (e.g. "Non-Diabetic: <5.7% / Pre Diabetic:
  // 5.7-6.4% / Diabetic: >=6.5%").
  const printedBand = 'Non-Diabetic Level: < 5.7% Pre Diabetic 5.7-6.4% Diabetic Level: >=6.5% Goal 7.0%';
  assert.equal(determineResultStatus({ normalizedValue: 5.4, referenceRangeRaw: printedBand }, hba1cStandard), 'normal');
  assert.equal(determineResultStatus({ normalizedValue: 6.8, referenceRangeRaw: printedBand }, hba1cStandard), 'abnormal');

  // No printed range at all (e.g. a home glucometer reading).
  const glucoseStandard = { range_low: 70, range_high: 139 };
  assert.equal(determineResultStatus({ normalizedValue: 129 }, glucoseStandard), 'normal');
  assert.equal(determineResultStatus({ normalizedValue: 210 }, glucoseStandard), 'abnormal');
});

test('determineResultStatus still trusts an explicit flag or a parseable printed range over the standard fallback', () => {
  const standard = { range_low: 70, range_high: 99 };
  assert.equal(determineResultStatus({ statusFlag: 'High', normalizedValue: 80 }, standard), 'abnormal');
  assert.equal(determineResultStatus({ normalizedValue: 200, referenceRangeRaw: '150-250' }, standard), 'normal');
});

test('buildOrganSummaries uses the standard-range fallback so a diabetes card with real-world data actually scores', () => {
  const standardRangesByCode = new Map([
    ['glucose', { range_low: 70, range_high: 139 }],
    ['hba1c', { range_low: 4.0, range_high: 5.6 }],
    ['insulin_fasting', { range_low: 2.6, range_high: 24.9 }],
  ]);
  const rows = [
    { code: 'glucose', displayName: 'Glucose', category: 'diabetes', normalizedValue: 129 },
    {
      code: 'hba1c',
      displayName: 'Hemoglobin A1c',
      category: 'diabetes',
      normalizedValue: 6.8,
      referenceRangeRaw: 'Non-Diabetic: <5.7% Pre Diabetic 5.7-6.4% Diabetic: >=6.5%',
    },
    { code: 'insulin_fasting', displayName: 'Insulin, Fasting', category: 'diabetes', normalizedValue: 10.1 },
  ];

  const diabetes = buildOrganSummaries(rows, standardRangesByCode).find((s) => s.key === 'diabetes');
  assert.equal(diabetes.trackedCount, 3);
  assert.equal(diabetes.normalCount, 2); // glucose + insulin in range, HbA1c abnormal
  assert.equal(diabetes.attentionCount, 1);
  assert.notEqual(diabetes.scorePercent, null);
  assert.notEqual(diabetes.status, 'no_data');
});

test('determineResultStatus matches a qualitative urinalysis result against its known-normal wording', () => {
  assert.equal(determineResultStatus({ code: 'urine_clarity', qualitativeValue: 'Clear' }), 'normal');
  assert.equal(determineResultStatus({ code: 'urine_clarity', qualitativeValue: 'Turbid' }), 'abnormal');
  // Different labs word the same "nothing detected" result differently -
  // "Nil" and "Negative" are both accepted for the same qualitative test.
  assert.equal(determineResultStatus({ code: 'urine_protein', qualitativeValue: 'Nil' }), 'normal');
  assert.equal(determineResultStatus({ code: 'urine_protein', qualitativeValue: 'Negative' }), 'normal');
  assert.equal(determineResultStatus({ code: 'urine_protein', qualitativeValue: 'Positive' }), 'abnormal');
  // A parameter with no qualitative-normal entry (e.g. a numeric-only code)
  // is unaffected and still falls through to 'unknown'.
  assert.equal(determineResultStatus({ code: 'glucose', qualitativeValue: 'Nil' }), 'unknown');
});

test('kidney card folds in urine complete analysis results, scored via known-normal qualitative wording', () => {
  const rows = [
    { code: 'creatinine', displayName: 'Creatinine', category: 'kidney', statusFlag: 'Normal', numericValue: 1 },
    { code: 'urine_clarity', displayName: 'Urine Clarity', category: 'urine', qualitativeValue: 'Clear' },
    { code: 'urine_protein', displayName: 'Protein, Urine', category: 'urine', qualitativeValue: 'Positive' },
  ];
  const kidney = buildOrganSummaries(rows).find((s) => s.key === 'kidney');
  assert.equal(kidney.trackedCount, 3);
  assert.equal(kidney.normalCount, 2);
  assert.equal(kidney.attentionCount, 1);
  assert.deepEqual(
    kidney.parameters.map((p) => p.code).sort(),
    ['creatinine', 'urine_clarity', 'urine_protein']
  );
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

test('buildCardSummaries backs ad-hoc (non-organ) groups the same way, e.g. for unmapped results with no registry code', () => {
  // Shape routes/dashboard.js's /custom-cards builds for a result that
  // matched nothing in the Health Parameter Registry (health_parameter_id
  // IS NULL) - no `code`, and `category` is an AI/heuristic-assigned group
  // label rather than a registry category.
  const rows = [
    {
      code: null,
      displayName: 'A/G Ratio',
      category: 'Proteins',
      rawValue: '1.4',
      numericValue: 1.4,
      referenceRangeRaw: '1.1-2.5',
    },
    {
      code: null,
      displayName: 'Albumin',
      category: 'Proteins',
      rawValue: '4.02',
      numericValue: 4.02,
      referenceRangeRaw: '3.5-5.0',
    },
  ];
  const groups = [{ key: 'custom:proteins', label: 'Proteins', icon: '🧬', categories: ['Proteins'] }];

  const [proteins] = buildCardSummaries(rows, groups);
  assert.equal(proteins.key, 'custom:proteins');
  assert.equal(proteins.trackedCount, 2);
  assert.equal(proteins.normalCount, 2);
  assert.deepEqual(
    proteins.parameters.map((p) => p.displayName).sort(),
    ['A/G Ratio', 'Albumin']
  );
  // Never fabricates a registry code for a result that has none.
  assert.ok(proteins.parameters.every((p) => p.code === null));
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
