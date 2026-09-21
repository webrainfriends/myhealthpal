const test = require('node:test');
const assert = require('node:assert/strict');
const { detectExpiry, detectCourseEnd, detectRefillNeeded, evaluateMedicationAlerts } = require('../src/medications/medicationAlertRules');

function medication(overrides) {
  return {
    id: 'med-1',
    name: 'Metformin',
    status: 'active',
    expiry_date: null,
    start_date: null,
    duration_days: null,
    end_date: null,
    quantity_dispensed: null,
    frequency_per_day: null,
    ...overrides,
  };
}

const TODAY = new Date('2026-06-15T00:00:00Z');

test('detectExpiry is null with no expiry date', () => {
  assert.equal(detectExpiry(medication(), TODAY), null);
});

test('detectExpiry fires "expired" for a past date', () => {
  const candidate = detectExpiry(medication({ expiry_date: '2026-06-01' }), TODAY);
  assert.equal(candidate.type, 'expired');
  assert.equal(candidate.severity, 'important');
});

test('detectExpiry fires "expiring_soon" with escalating severity as the date nears', () => {
  const far = detectExpiry(medication({ expiry_date: '2026-07-10' }), TODAY); // 25 days out
  assert.equal(far.type, 'expiring_soon');
  assert.equal(far.severity, 'info');

  const near = detectExpiry(medication({ expiry_date: '2026-06-18' }), TODAY); // 3 days out
  assert.equal(near.type, 'expiring_soon');
  assert.equal(near.severity, 'attention');
});

test('detectExpiry is null well before the expiry window', () => {
  assert.equal(detectExpiry(medication({ expiry_date: '2027-01-01' }), TODAY), null);
});

test('detectCourseEnd only applies to active medications', () => {
  const med = medication({ end_date: '2026-06-16', status: 'completed' });
  assert.equal(detectCourseEnd(med, TODAY), null);
});

test('detectCourseEnd fires "course_ending" then "course_completed"', () => {
  const ending = detectCourseEnd(medication({ end_date: '2026-06-17' }), TODAY);
  assert.equal(ending.type, 'course_ending');

  const completed = detectCourseEnd(medication({ end_date: '2026-06-10' }), TODAY);
  assert.equal(completed.type, 'course_completed');
});

test('detectRefillNeeded computes remaining supply from elapsed days x frequency', () => {
  // Started 27 days ago, 1/day, dispensed 30 -> 3 doses left -> due soon.
  const med = medication({ start_date: '2026-05-19', frequency_per_day: 1, quantity_dispensed: 30 });
  const candidate = detectRefillNeeded(med, TODAY);
  assert.ok(candidate);
  assert.equal(candidate.type, 'refill_needed');
  assert.equal(candidate.severity, 'info');
});

test('detectRefillNeeded escalates once supply is exhausted', () => {
  const med = medication({ start_date: '2026-05-01', frequency_per_day: 2, quantity_dispensed: 10 });
  const candidate = detectRefillNeeded(med, TODAY);
  assert.equal(candidate.severity, 'attention');
});

test('detectRefillNeeded is null with plenty of supply left', () => {
  const med = medication({ start_date: '2026-06-14', frequency_per_day: 1, quantity_dispensed: 60 });
  assert.equal(detectRefillNeeded(med, TODAY), null);
});

test('evaluateMedicationAlerts can return multiple simultaneous alerts', () => {
  const med = medication({
    expiry_date: '2026-06-16',
    start_date: '2026-05-01',
    duration_days: 46,
    end_date: '2026-06-16',
    frequency_per_day: 2,
    quantity_dispensed: 90,
  });
  const candidates = evaluateMedicationAlerts(med, TODAY);
  const types = candidates.map((c) => c.type);
  assert.ok(types.includes('expiring_soon'));
  assert.ok(types.includes('course_ending'));
});
