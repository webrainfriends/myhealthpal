const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/medications/medicationReminderRules');
const dash = require('../src/family/beneficiaryDashboardRules');

const TODAY = '2026-10-01';
const med = (over = {}) => ({ id: 'm1', name: 'Metformin', status: 'active', is_confirmed: true, frequency_per_day: 2, quantity_dispensed: 10, ...over });
const log = (date, slot, status = 'taken') => ({ scheduled_date: date, slot, status, logged_at: `${date}T08:00:00Z` });

test('slots come from times_of_day, else frequency', () => {
  assert.deepEqual(rules.dailySlots(med({ times_of_day: ['08:00', '20:00'] })), ['08:00', '20:00']);
  assert.deepEqual(rules.dailySlots(med()), ['morning', 'night']);
  assert.equal(rules.dailySlots(med({ frequency_per_day: null })), null);
});

test('reminder works with no lab data: qty drives doses left', () => {
  const r = rules.buildReminder(med(), [log('2026-09-30', 'morning'), log(TODAY, 'morning')], TODAY);
  assert.equal(r.active, true);
  assert.equal(r.dosesRemaining, 8);
  assert.deepEqual(r.doses.map((d) => [d.slot, d.status]), [['morning', 'taken'], ['night', 'pending']]);
  assert.equal(r.daysOfSupplyLeft, 4);
});

test('total_doses overrides quantity; reminders stop when doses run out', () => {
  const m = med({ total_doses: 2 });
  const r = rules.buildReminder(m, [log('2026-09-30', 'morning'), log('2026-09-30', 'night')], TODAY);
  assert.equal(r.stopReason, 'out_of_doses');
  assert.equal(r.dueCount, 0);
});

test('pending slots are capped by remaining doses', () => {
  const r = rules.buildReminder(med({ total_doses: 5 }), [1, 2, 3, 4].map((i) => log(`2026-09-2${i}`, 'morning')), TODAY);
  assert.equal(r.dosesRemaining, 1);
  assert.equal(r.dueCount, 1);
});

test('skipped doses do not use supply', () => {
  const r = rules.buildReminder(med(), [log(TODAY, 'morning', 'skipped')], TODAY);
  assert.equal(r.dosesRemaining, 10);
  assert.equal(r.skippedCount, 1);
});

test('expiry, course end, paused and not-started stop reminders', () => {
  const reason = (over) => rules.buildReminder(med(over), [], TODAY).stopReason;
  assert.equal(reason({ expiry_date: '2026-09-30' }), 'expired');
  assert.equal(reason({ expiry_date: TODAY }), null, 'expires end of day');
  assert.equal(reason({ end_date: '2026-09-30' }), 'course_ended');
  assert.equal(reason({ start_date: '2026-10-05' }), 'not_started');
  assert.equal(reason({ reminders_enabled: false }), 'paused');
  assert.equal(reason({ status: 'completed' }), 'inactive');
});

test('countMissed counts unlogged scheduled slots in the last 3 days only within the course', () => {
  const m = med({ start_date: '2026-09-30' });
  // 09-30 morning logged; 09-30 night missed; no earlier days (before start)
  assert.equal(rules.countMissed(m, [log('2026-09-30', 'morning')], TODAY), 1);
  assert.equal(rules.countMissed(med(), [], TODAY), 6);
});

test('isValidSlot', () => {
  assert.equal(rules.isValidSlot(med(), 'morning'), true);
  assert.equal(rules.isValidSlot(med(), 'noon'), false);
});

test('dashboard summary carries adherence and flags missed doses as attention', () => {
  const m = med({ start_date: '2026-09-01', quantity_dispensed: 500 });
  const reminder = { ...rules.buildReminder(m, [], TODAY), missedRecent: 4 };
  const summary = dash.summarizeMedications([m], new Date(`${TODAY}T00:00:00Z`), new Map([['m1', reminder]]));
  assert.equal(summary.missedDoseCount, 4);
  assert.equal(summary.dosesDueToday, 2);
  assert.equal(summary.items[0].reminder.dosesRemaining, 500);
  const level = dash.attentionLevel({
    testsDue: { overdueCount: 0, dueSoonCount: 0 }, medications: summary,
    health: { criticalCount: 0, outOfRangeCount: 0 }, insurance: { upcoming: [], gapCount: 0, needsReviewCount: 0 },
  });
  assert.equal(level, 'attention');
});

test('multi-select times of day, incl. morning + afternoon + night', () => {
  const m = med({ frequency_per_day: 1, times_of_day: ['morning', 'afternoon', 'night'] });
  assert.deepEqual(rules.dailySlots(m), ['morning', 'afternoon', 'night']);
});

test('every X hours expands to clock times from the first dose time', () => {
  assert.deepEqual(rules.dailySlots(med({ interval_hours: 8 })), ['00:00', '08:00', '16:00']);
  assert.deepEqual(rules.dailySlots(med({ interval_hours: 6, times_of_day: ['06:00'] })), ['00:00', '06:00', '12:00', '18:00']);
  assert.equal(rules.dailySlots(med({ interval_hours: 0 })).length, 2, 'invalid interval falls back to frequency');
});

test('reminder exposes the food relation', () => {
  const r = rules.buildReminder(med({ food_relation: 'after_food' }), [], TODAY);
  assert.equal(r.foodRelation, 'after_food');
});
