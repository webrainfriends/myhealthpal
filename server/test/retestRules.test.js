const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateRetest,
  detectAbnormalRecheck,
  detectMedicationOnset,
  microActionFor,
  daysUntil,
  weekStart,
  checkinStreak,
  reminderKind,
  CRITICAL_INTERVAL_DAYS,
} = require('../src/retest/retestRules');
const { pendingReminders, buildMessage } = require('../src/retest/retestReminderService');

function latest(overrides) {
  return { measurementId: 'm-1', statusFlag: 'Low', effectiveDate: '2026-08-03', ...overrides };
}

const TODAY = new Date('2026-09-24T09:00:00Z'); // a Thursday

test('normal result with no medication produces no plan', () => {
  assert.equal(evaluateRetest({ parameterCode: 'vitamin_d', latest: latest({ statusFlag: 'Normal' }), medicationLinks: [] }), null);
});

test('abnormal result gets the parameter-specific recheck interval', () => {
  const plan = evaluateRetest({ parameterCode: 'vitamin_d', latest: latest(), medicationLinks: [] });
  assert.equal(plan.reason, 'abnormal_recheck');
  assert.equal(plan.dueDate, '2026-10-26'); // 84 days after 2026-08-03
  assert.equal(plan.lastMeasurementId, 'm-1');
  assert.match(plan.microAction, /sunlight/);
});

test('unknown parameter falls back to the default 90-day interval', () => {
  const plan = detectAbnormalRecheck(latest({ statusFlag: 'High' }), 'some_new_code');
  assert.equal(plan.dueDate, '2026-11-01');
});

test('critical flag shortens the recheck to two weeks', () => {
  const plan = detectAbnormalRecheck(latest({ statusFlag: 'Critically High' }), 'potassium');
  assert.equal(plan.critical, true);
  assert.equal(plan.dueDate, '2026-08-17');
  assert.equal(CRITICAL_INTERVAL_DAYS, 14);
});

test('medication started after the last result sets a due date at the end of its onset window', () => {
  const plan = detectMedicationOnset(latest({ statusFlag: 'Normal', effectiveDate: '2026-01-10' }), [
    { medicationName: 'Metformin', startDate: '2026-03-01', onsetWeeksMin: 8, onsetWeeksMax: 12 },
  ]);
  assert.equal(plan.reason, 'medication_onset');
  assert.equal(plan.medicationName, 'Metformin');
  assert.equal(plan.dueDate, '2026-05-24'); // 12 weeks after start
});

test('a result already measured inside the onset window closes the medication rule', () => {
  const plan = detectMedicationOnset(latest({ effectiveDate: '2026-05-01' }), [
    { medicationName: 'Metformin', startDate: '2026-03-01', onsetWeeksMin: 8, onsetWeeksMax: 12 },
  ]);
  assert.equal(plan, null);
});

test('medication with no result yet still gets a plan', () => {
  const plan = evaluateRetest({
    parameterCode: 'vitamin_b12',
    latest: null,
    medicationLinks: [{ medicationName: 'Metformin', startDate: '2026-03-01', onsetWeeksMin: 26, onsetWeeksMax: null }],
  });
  assert.equal(plan.reason, 'medication_onset');
  assert.equal(plan.lastMeasurementId, null);
  assert.equal(plan.dueDate, '2026-08-30');
});

test('when both rules fire the earlier due date wins', () => {
  const plan = evaluateRetest({
    parameterCode: 'ldl_cholesterol',
    latest: latest({ statusFlag: 'High', effectiveDate: '2026-06-01' }), // abnormal -> +180d = 2026-11-28
    medicationLinks: [{ medicationName: 'Atorvastatin', startDate: '2026-06-10', onsetWeeksMin: 4, onsetWeeksMax: 6 }],
  });
  assert.equal(plan.reason, 'medication_onset');
  assert.equal(plan.dueDate, '2026-07-22');
});

test('micro-action falls back to a generic tip for an unmapped direction', () => {
  assert.match(microActionFor('vitamin_d', 'High'), /symptoms/);
  assert.match(microActionFor('hba1c', 'High'), /walk/);
});

test('daysUntil counts calendar days in UTC', () => {
  assert.equal(daysUntil('2026-10-27', TODAY), 33);
  assert.equal(daysUntil('2026-09-24', TODAY), 0);
  assert.equal(daysUntil('2026-09-20', TODAY), -4);
});

test('weekStart is the Monday of the week', () => {
  assert.equal(weekStart(TODAY), '2026-09-21');
  assert.equal(weekStart(new Date('2026-09-21T00:00:00Z')), '2026-09-21');
  assert.equal(weekStart(new Date('2026-09-27T23:00:00Z')), '2026-09-21');
});

test('checkin streak counts consecutive weeks and tolerates an unticked current week', () => {
  assert.equal(checkinStreak(['2026-09-21', '2026-09-14', '2026-09-07'], TODAY), 3);
  assert.equal(checkinStreak(['2026-09-14', '2026-09-07'], TODAY), 2);
  assert.equal(checkinStreak(['2026-09-21', '2026-09-07'], TODAY), 1);
  assert.equal(checkinStreak([], TODAY), 0);
});

test('reminderKind fires two weeks out and on/after the due date', () => {
  assert.equal(reminderKind('2026-11-30', TODAY), null);
  assert.equal(reminderKind('2026-10-08', TODAY), 'two_weeks');
  assert.equal(reminderKind('2026-09-24', TODAY), 'due');
  assert.equal(reminderKind('2026-09-01', TODAY), 'due');
});

function plan(overrides) {
  return {
    id: 'p-1',
    parameterDisplayName: 'Vitamin D',
    dueDate: '2026-12-01',
    daysLeft: 68,
    microAction: 'Get 15 minutes of morning sunlight on 3 days this week.',
    checkedInThisWeek: false,
    ...overrides,
  };
}

test('pendingReminders prefers due over two-week over weekly tip, and skips already-sent ones', () => {
  const plans = [
    plan({ id: 'tip' }),
    plan({ id: 'soon', parameterDisplayName: 'HbA1c', dueDate: '2026-10-05', daysLeft: 11 }),
    plan({ id: 'due', parameterDisplayName: 'TSH', dueDate: '2026-09-20', daysLeft: -4 }),
    plan({ id: 'ticked', checkedInThisWeek: true }),
  ];
  const pending = pendingReminders(plans, new Set(), TODAY);
  // A plan's date reminder silently stands in for its weekly tip that week.
  assert.deepEqual(
    pending.map((p) => `${p.plan.id}:${p.kind}${p.silent ? ':silent' : ''}`),
    ['due:due', 'soon:two_weeks', 'due:weekly_tip:silent', 'soon:weekly_tip:silent', 'tip:weekly_tip']
  );

  const alreadySent = new Set(['due:due:2026-09-20', 'tip:weekly_tip:2026-09-21']);
  const after = pendingReminders(plans, alreadySent, TODAY);
  // An already-notified due plan still gets its weekly tip, shown this time.
  assert.deepEqual(
    after.map((p) => `${p.plan.id}:${p.kind}${p.silent ? ':silent' : ''}`),
    ['soon:two_weeks', 'due:weekly_tip', 'soon:weekly_tip:silent']
  );
});

test('buildMessage leads with the most urgent item and counts the rest', () => {
  const message = buildMessage([
    { plan: plan({ id: 'a', parameterDisplayName: 'TSH', daysLeft: 0 }), kind: 'due' },
    { plan: plan({ id: 'a' }), kind: 'weekly_tip', silent: true },
    { plan: plan({ id: 'b' }), kind: 'weekly_tip' },
  ]);
  assert.equal(message.title, 'Time to recheck your TSH');
  assert.match(message.body, /\+1 more/);
  assert.equal(message.data.planId, 'a');
});
