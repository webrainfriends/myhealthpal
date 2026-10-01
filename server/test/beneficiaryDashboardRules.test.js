const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/family/beneficiaryDashboardRules');

const TODAY = new Date('2026-09-30T00:00:00Z');

test('summarizeTestsDue separates overdue from due-soon', () => {
  const summary = rules.summarizeTestsDue([
    { id: 'a', parameterCode: 'hba1c', parameterDisplayName: 'HbA1c', dueDate: '2026-09-20', daysLeft: -10, flag: 'high', reason: 'x' },
    { id: 'b', parameterCode: 'tsh', parameterDisplayName: 'TSH', dueDate: '2026-10-05', daysLeft: 5, flag: 'high', reason: 'x' },
    { id: 'c', parameterCode: 'iron', parameterDisplayName: 'Iron', dueDate: '2027-01-01', daysLeft: 93, flag: 'low', reason: 'x' },
  ]);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.dueSoonCount, 1);
  assert.deepEqual(summary.items.map((i) => [i.testName, i.overdue, i.dueSoon]), [
    ['HbA1c', true, false],
    ['TSH', false, true],
    ['Iron', false, false],
  ]);
});

test('summarizeMedications flags refill-soon and expiring-soon without persisting anything', () => {
  const summary = rules.summarizeMedications(
    [
      { id: '1', name: 'Metformin', frequency_per_day: 2, times_of_day: ['morning', 'night'], quantity_dispensed: 60, start_date: '2026-09-01', status: 'active' },
      { id: '2', name: 'Vitamin D', frequency_per_day: 1, expiry_date: '2026-10-10', status: 'active' },
      { id: '3', name: 'Aspirin', frequency_per_day: 1, status: 'active' },
    ],
    TODAY
  );
  assert.equal(summary.activeCount, 3);
  assert.equal(summary.refillSoonCount, 1, 'Metformin: 60 doses, 29 days x 2/day leaves ~1 day');
  assert.equal(summary.expiringSoonCount, 1);
  assert.equal(summary.items.at(-1).name, 'Aspirin', 'medications with no alert sort last');
  const metformin = summary.items.find((m) => m.name === 'Metformin');
  assert.equal(metformin.frequency, '2 times a day');
  assert.deepEqual(metformin.timesOfDay, ['morning', 'night']);
});

test('summarizeLabResults keeps only out-of-range results, worst first', () => {
  const summary = rules.summarizeLabResults([
    { code: 'creatinine', displayName: 'Creatinine', category: 'Kidney', rawValue: '1.9', rawUnit: 'mg/dL', statusFlag: 'High', numericValue: 1.9, effectiveDate: '2026-09-01' },
    { code: 'ldl_cholesterol', displayName: 'LDL', category: 'Lipids', rawValue: '95', rawUnit: 'mg/dL', statusFlag: 'Normal', numericValue: 95, effectiveDate: '2026-08-01' },
    { code: 'hba1c', displayName: 'HbA1c', category: 'Diabetes', rawValue: '9', rawUnit: '%', statusFlag: 'Critically High', numericValue: 9, effectiveDate: '2026-09-15' },
  ]);
  assert.equal(summary.evaluatedCount, 3);
  assert.equal(summary.outOfRangeCount, 2);
  assert.equal(summary.criticalCount, 1);
  assert.deepEqual(summary.outOfRange.map((r) => r.name), ['HbA1c', 'Creatinine']);
  assert.equal(summary.latestResultDate, '2026-09-15');
});

const EMPTY = {
  testsDue: { overdueCount: 0, dueSoonCount: 0, items: [] },
  medications: { refillSoonCount: 0, expiringSoonCount: 0, items: [] },
  health: { criticalCount: 0, outOfRangeCount: 0 },
  insurance: { upcoming: [], gapCount: 0, needsReviewCount: 0 },
};

test('attentionLevel: ok / attention / urgent', () => {
  assert.equal(rules.attentionLevel(EMPTY), 'ok');
  assert.equal(rules.attentionLevel({ ...EMPTY, medications: { ...EMPTY.medications, refillSoonCount: 1 } }), 'attention');
  assert.equal(rules.attentionLevel({ ...EMPTY, health: { criticalCount: 0, outOfRangeCount: 2 } }), 'attention');
  assert.equal(rules.attentionLevel({ ...EMPTY, testsDue: { ...EMPTY.testsDue, overdueCount: 1 } }), 'urgent');
  assert.equal(rules.attentionLevel({ ...EMPTY, insurance: { ...EMPTY.insurance, upcoming: [{ overdue: true }] } }), 'urgent');
  assert.equal(rules.attentionLevel({ ...EMPTY, health: { criticalCount: 1, outOfRangeCount: 1 } }), 'urgent');
});

test('sortCards puts the most urgent person first and totals add up', () => {
  const card = (name, attention, extra = {}) => ({
    displayName: name,
    attention,
    testsDue: { overdueCount: 0, dueSoonCount: 0, ...extra.testsDue },
    insurance: { activePolicyCount: 1, upcoming: [] },
    medications: { refillSoonCount: 0, expiringSoonCount: 0, ...extra.medications },
    health: { outOfRangeCount: 0, ...extra.health },
  });
  const cards = rules.sortCards([
    card('Zed', 'ok'),
    card('Amy', 'attention', { medications: { refillSoonCount: 2 } }),
    card('Bob', 'urgent', { testsDue: { overdueCount: 1 }, health: { outOfRangeCount: 3 } }),
  ]);
  assert.deepEqual(cards.map((c) => c.displayName), ['Bob', 'Amy', 'Zed']);
  const totals = rules.buildTotals(cards);
  assert.equal(totals.beneficiaryCount, 3);
  assert.equal(totals.needingAttention, 2);
  assert.equal(totals.urgentCount, 1);
  assert.equal(totals.refillsSoon, 2);
  assert.equal(totals.testsOverdue, 1);
  assert.equal(totals.outOfRangeResults, 3);
  assert.equal(totals.activePolicies, 3);
});

test('summarizeInsurance flags renewals within 90 days but premiums only within 30', () => {
  const overview = {
    policies: [{ id: 'a' }, { id: 'b' }],
    activePolicyIds: ['a', 'b'],
    gaps: [],
    upcoming: [
      { kind: 'renewal', policyId: 'a', daysLeft: 80, overdue: false },
      { kind: 'renewal', policyId: 'b', daysLeft: 120, overdue: false },
      { kind: 'premium', policyId: 'a', daysLeft: 60, overdue: false },
      { kind: 'premium', policyId: 'b', daysLeft: 10, overdue: false },
    ],
  };
  const summary = rules.summarizeInsurance(overview, { policyCount: 2, needsReviewCount: 0, providerNames: [], nextPremium: null, nextRenewal: null, gapCount: 0 });
  assert.equal(summary.activePolicyCount, 2);
  assert.equal(summary.renewalCount, 1);
  assert.deepEqual(summary.upcoming.map((d) => `${d.kind}:${d.policyId}`), ['renewal:a', 'premium:b']);
});
