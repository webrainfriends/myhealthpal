const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/insurance/insuranceRules');
const { normalizeExtraction } = require('../src/extraction/providers/insuranceExtractionProvider');
const { pendingInsuranceReminders } = require('../src/insurance/insuranceRules');
const { buildMessage } = require('../src/insurance/insuranceReminderService');

const TODAY = new Date('2026-09-30T09:00:00Z');

function item(overrides) {
  return {
    id: `item-${Math.random()}`,
    organ_key: 'heart',
    condition_name: 'Cardiac surgery',
    coverage_status: 'covered',
    ceiling_amount: null,
    copay_percent: null,
    waiting_period_months: null,
    ...overrides,
  };
}

function policy(overrides) {
  return {
    id: 'p1',
    provider_name: 'Acme Health',
    plan_name: 'Gold',
    original_filename: 'gold.pdf',
    sum_insured: 500000,
    currency: 'INR',
    policy_start_date: '2026-01-01',
    policy_end_date: '2026-12-31',
    items: [],
    ...overrides,
  };
}

test('addMonths clamps to the end of a shorter month', () => {
  assert.equal(rules.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(rules.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(rules.addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(rules.addMonths(null, 3), null);
});

test('policyPeriod reports active, upcoming, expired and how far through the term we are', () => {
  const active = rules.policyPeriod(policy({}), TODAY);
  assert.equal(active.state, 'active');
  assert.equal(active.daysToEnd, 92);
  assert.ok(active.elapsedPercent > 70 && active.elapsedPercent < 80);
  assert.equal(rules.policyPeriod(policy({ policy_end_date: '2026-06-01' }), TODAY).state, 'expired');
  assert.equal(rules.policyPeriod(policy({ policy_start_date: '2026-11-01' }), TODAY).state, 'upcoming');
  assert.equal(rules.policyPeriod({}, TODAY).state, 'unknown');
});

test('nextPremiumDue keeps a future printed date, and rolls a passed one forward by the frequency', () => {
  const future = rules.nextPremiumDue(policy({ next_premium_due_date: '2026-10-10', premium_frequency: 'quarterly' }), TODAY);
  assert.deepEqual(future, { dueDate: '2026-10-10', daysLeft: 10, overdue: false, estimated: false });

  const rolled = rules.nextPremiumDue(policy({ next_premium_due_date: '2026-06-10', premium_frequency: 'quarterly' }), TODAY);
  assert.equal(rolled.dueDate, '2026-12-10');
  assert.equal(rolled.estimated, true);

  // No printed date: the first instalment after the start date, rolled.
  const derived = rules.nextPremiumDue(policy({ premium_frequency: 'monthly' }), TODAY);
  assert.equal(derived.dueDate, '2026-10-01');
  assert.equal(derived.estimated, true);
});

test('nextPremiumDue: a single premium has nothing further once paid, and the next instalment never falls after the policy ends', () => {
  assert.equal(rules.nextPremiumDue(policy({ next_premium_due_date: '2026-03-01', premium_frequency: 'single' }), TODAY), null);
  assert.equal(rules.nextPremiumDue(policy({ next_premium_due_date: '2026-06-10', premium_frequency: 'annual', policy_end_date: '2026-12-31' }), TODAY), null);
  assert.equal(rules.nextPremiumDue(policy({}), TODAY), null);
});

test('a policy lists its organ status: covered, partial (mixed or restricted) and not covered', () => {
  const covered = policy({ items: [item({ organ_key: 'heart' })] });
  assert.equal(rules.summarizePolicyOrgan(covered, 'heart', TODAY).status, 'covered');

  const mixed = policy({ items: [item({ organ_key: 'heart' }), item({ organ_key: 'heart', condition_name: 'Congenital heart disease', coverage_status: 'excluded' })] });
  const mixedSummary = rules.summarizePolicyOrgan(mixed, 'heart', TODAY);
  assert.equal(mixedSummary.status, 'partial');
  assert.deepEqual(mixedSummary.excludedConditions, ['Congenital heart disease']);

  const restricted = policy({ items: [item({ organ_key: 'kidney', coverage_status: 'partial', ceiling_amount: 100000, copay_percent: 10 })] });
  const restrictedSummary = rules.summarizePolicyOrgan(restricted, 'kidney', TODAY);
  assert.equal(restrictedSummary.status, 'partial');
  assert.equal(restrictedSummary.maxCeiling, 100000);
  assert.equal(restrictedSummary.maxCopayPercent, 10);

  const excluded = policy({ items: [item({ organ_key: 'cancer', coverage_status: 'excluded' })] });
  assert.equal(rules.summarizePolicyOrgan(excluded, 'cancer', TODAY).status, 'not_covered');
  assert.equal(rules.summarizePolicyOrgan(covered, 'kidney', TODAY), null);
});

test('waiting periods are measured from the policy start date', () => {
  const p = policy({ items: [item({ organ_key: 'heart', waiting_period_months: 24 })] });
  const summary = rules.summarizePolicyOrgan(p, 'heart', TODAY);
  assert.equal(summary.inWaiting, true);
  assert.equal(summary.waitingUntil, '2028-01-01');

  const past = policy({ policy_start_date: '2023-01-01', items: [item({ organ_key: 'heart', waiting_period_months: 24 })] });
  assert.equal(rules.summarizePolicyOrgan(past, 'heart', TODAY).inWaiting, false);
});

test('several policies can be tagged on the same organ, each with its own stance', () => {
  const a = policy({ id: 'a', plan_name: 'A', items: [item({ organ_key: 'diabetes', coverage_status: 'excluded', condition_name: 'Diabetes' })] });
  const b = policy({ id: 'b', plan_name: 'B', items: [item({ organ_key: 'diabetes', condition_name: 'Diabetes complications', ceiling_amount: 200000 })] });
  const coverage = rules.coverageForOrgan([a, b], 'diabetes', TODAY);
  assert.equal(coverage.overall, 'covered');
  assert.equal(coverage.entries.length, 2);
  assert.deepEqual(coverage.entries.map((e) => e.status).sort(), ['covered', 'not_covered']);

  assert.equal(rules.coverageForOrgan([a], 'diabetes', TODAY).overall, 'not_covered');
  assert.equal(rules.coverageForOrgan([a], 'heart', TODAY).overall, 'not_mentioned');
});

test('lab parameters map to the insurance organs their dashboard cards feed', () => {
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'ldl_cholesterol', category: 'lipids' }), ['heart']);
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'hba1c', category: 'diabetes' }), ['diabetes']);
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'tsh', category: 'thyroid' }), ['thyroid_endocrine']);
  // Tests a dashboard card only claims by code as soft relevance (vitamin D
  // on Bones/Brain) are not evidence of a bone or brain condition.
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'vitamin_d', category: 'vitamins' }), []);
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'creatinine', category: 'kidney' }), ['kidney']);
  // Vitamins feed no insurance organ, so they never get a misleading tag.
  assert.deepEqual(rules.insuranceOrgansForParameter({ code: 'vitamin_c', category: 'vitamins' }), []);
  assert.equal(rules.tagParameter({ code: 'vitamin_c', category: 'vitamins' }, [policy({})], TODAY), null);
});

test('tagParameter gives the best verdict across organs and policies', () => {
  const p = policy({ items: [item({ organ_key: 'kidney' })] });
  const tag = rules.tagParameter({ code: 'creatinine', displayName: 'Creatinine', category: 'kidney' }, [p], TODAY);
  assert.equal(tag.overall, 'covered');
  const none = rules.tagParameter({ code: 'ldl_cholesterol', displayName: 'LDL', category: 'lipids' }, [p], TODAY);
  assert.equal(none.overall, 'not_mentioned');
});

test('coverage gaps: nothing to compare against without a confirmed policy', () => {
  assert.deepEqual(rules.computeCoverageGaps({ policies: [], abnormal: [{ code: 'creatinine', category: 'kidney', displayName: 'Creatinine' }], today: TODAY }), []);
});

test('coverage gaps: not mentioned, excluded, waiting period, low ceiling and high co-pay', () => {
  const abnormal = [
    { code: 'creatinine', displayName: 'Creatinine', category: 'kidney', direction: 'high', severity: 'marked' },
    { code: 'ldl_cholesterol', displayName: 'LDL Cholesterol', category: 'lipids', direction: 'high', severity: 'mild' },
    { code: 'hemoglobin', displayName: 'Hemoglobin', category: 'hematology', direction: 'low', severity: 'mild' },
    { code: 'alt', displayName: 'ALT', category: 'liver', direction: 'high', severity: 'mild' },
    { code: 'psa_total', displayName: 'PSA', category: 'tumor_markers', direction: 'high', severity: 'mild' },
  ];
  const p = policy({
    agent_name: 'Asha',
    agent_phone: '+91 90000 00000',
    items: [
      // kidney: not mentioned at all (no items) -> not_mentioned
      // heart: excluded only
      item({ organ_key: 'heart', coverage_status: 'excluded', condition_name: 'All heart disease' }),
      // blood: covered but in waiting period
      item({ organ_key: 'blood', waiting_period_months: 24 }),
      // liver: capped at 10% of the sum insured
      item({ organ_key: 'liver_pancreas', ceiling_amount: 50000 }),
      // cancer: 30% co-pay, no ceiling
      item({ organ_key: 'cancer', copay_percent: 30 }),
    ],
  });
  const gaps = rules.computeCoverageGaps({ policies: [p], abnormal, today: TODAY });
  const byOrgan = Object.fromEntries(gaps.map((g) => [g.organKey, g]));

  assert.equal(byOrgan.kidney.type, 'not_mentioned');
  assert.equal(byOrgan.kidney.severity, 'high'); // marked finding
  assert.equal(byOrgan.heart.type, 'excluded');
  assert.equal(byOrgan.heart.severity, 'high');
  assert.equal(byOrgan.blood.type, 'waiting_period');
  assert.match(byOrgan.blood.message, /2028-01-01/);
  assert.equal(byOrgan.liver_pancreas.type, 'low_ceiling');
  assert.equal(byOrgan.cancer.type, 'high_copay');

  // Most urgent first; each gap carries questions and a ready-to-send draft
  // addressed to the agent.
  assert.equal(gaps[0].severity, 'high');
  assert.ok(byOrgan.kidney.suggestedQuestions.length >= 2);
  assert.equal(byOrgan.kidney.contact.name, 'Asha');
  assert.match(byOrgan.kidney.draftMessage, /^Hello Asha,/);
  assert.match(byOrgan.kidney.draftMessage, /Creatinine \(high\)/);
});

test('coverage gaps: well-covered organs raise nothing', () => {
  const p = policy({ items: [item({ organ_key: 'kidney', ceiling_amount: 500000 })] });
  const gaps = rules.computeCoverageGaps({
    policies: [p],
    abnormal: [{ code: 'creatinine', displayName: 'Creatinine', category: 'kidney', direction: 'high', severity: 'mild' }],
    today: TODAY,
  });
  assert.deepEqual(gaps, []);
});

test('reminders: premium within 14 days, on/after due, and renewal windows - each once per period', () => {
  const soon = policy({ id: 'soon', next_premium_due_date: '2026-10-05', premium_frequency: 'annual', policy_end_date: '2027-03-31' });
  const due = policy({ id: 'due', next_premium_due_date: '2026-09-30', premium_frequency: 'annual', policy_end_date: '2027-03-31' });
  const renewing = policy({ id: 'ren', policy_end_date: '2026-10-20' });
  const later = policy({ id: 'later', next_premium_due_date: '2027-02-01', premium_frequency: 'annual', policy_end_date: '2027-03-31' });

  const pending = pendingInsuranceReminders([soon, due, renewing, later], new Set(), TODAY);
  assert.deepEqual(
    pending.map((p) => `${p.policy.id}:${p.kind}`),
    ['due:premium_due', 'soon:premium_14d', 'ren:renewal_30d']
  );

  const already = new Set(['due:premium_due:2026-09-30']);
  assert.ok(!pendingInsuranceReminders([due], already, TODAY).some((p) => p.kind === 'premium_due'));
});

test('reminder message leads with the most urgent item and counts the rest', () => {
  const p = policy({ id: 'due', next_premium_due_date: '2026-09-30', premium_frequency: 'annual', premium_amount: 12000 });
  const message = buildMessage(
    [
      { policy: p, kind: 'premium_due', period: '2026-09-30', daysLeft: 0, amount: 12000 },
      { policy: p, kind: 'renewal_30d', period: '2026-10-20', daysLeft: 20 },
    ],
    null
  );
  assert.match(message.title, /premium is due/);
  assert.match(message.body, /12,000/);
  assert.match(message.body, /\+1 more/);
  assert.equal(message.data.screen, 'Insurance');
});

test('extraction output is normalised into database-safe shapes', () => {
  const { policy: p, items } = normalizeExtraction({
    provider_name: '  Acme Health ',
    sum_insured: '5,00,000',
    policy_start_date: '2026-01-01',
    policy_end_date: 'next year', // not a real date -> dropped
    premium_frequency: 'fortnightly', // not an allowed value -> dropped
    contacts: { agent_name: 'Asha', agent_phone: ' +91 9 ', other: [{ role: 'Ombudsman', phone: '1' }, { name: 'no role' }] },
    coverage_items: [
      { organ_key: 'Heart', condition_name: 'Bypass', coverage_status: 'covered', ceiling_amount: '200000', copay_percent: 10, confidence: 0.9 },
      { organ_key: 'made_up_organ', condition_name: 'Cosmetic surgery', coverage_status: 'excluded', confidence: 0.5 },
      { organ_key: 'heart', condition_name: '', coverage_status: 'covered' },
      { organ_key: 'heart', condition_name: 'Bad status', coverage_status: 'maybe' },
    ],
  });
  assert.equal(p.providerName, 'Acme Health');
  assert.equal(p.sumInsured, 500000);
  assert.equal(p.policyEndDate, null);
  assert.equal(p.premiumFrequency, null);
  assert.equal(p.agentPhone, '+91 9');
  assert.deepEqual(p.otherContacts, [{ role: 'Ombudsman', name: null, phone: '1', email: null }]);
  assert.equal(items.length, 2);
  assert.equal(items[0].organKey, 'heart');
  assert.equal(items[0].ceilingAmount, 200000);
  assert.equal(items[0].needsReview, false);
  assert.equal(items[1].organKey, 'general');
  assert.equal(items[1].needsReview, true);
});
