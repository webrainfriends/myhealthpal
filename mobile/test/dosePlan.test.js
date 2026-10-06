const test = require('node:test');
const assert = require('node:assert/strict');
const { planDoseNotifications, parseNotificationId } = require('../src/notifications/dosePlan');

const reminder = (overrides = {}) => ({
  medicationId: 'med-1',
  name: 'Metformin',
  foodRelation: 'with_food',
  active: true,
  doses: [
    { slot: 'morning', status: 'taken' },
    { slot: 'afternoon', status: 'pending' },
    { slot: 'night', status: 'pending' },
  ],
  ...overrides,
});

// 10 Oct 2026, 11:00 local.
const now = new Date(2026, 9, 10, 11, 0);

test('plans only doses still due today plus every dose tomorrow, in time order', () => {
  const plan = planDoseNotifications([reminder()], now);
  assert.deepEqual(
    plan.map((p) => `${p.date} ${p.slot}`),
    ['2026-10-10 afternoon', '2026-10-10 night', '2026-10-11 morning', '2026-10-11 afternoon', '2026-10-11 night']
  );
  assert.equal(plan[0].at.getHours(), 13);
  assert.equal(plan[0].name, 'Metformin');
});

test('skips doses whose time has passed, inactive medicines and slots with no clock time', () => {
  const late = new Date(2026, 9, 10, 14, 0);
  const plan = planDoseNotifications(
    [reminder(), reminder({ medicationId: 'med-2', active: false }), reminder({ medicationId: 'med-3', doses: [{ slot: 'dose 1', status: 'pending' }] })],
    late
  );
  assert.ok(plan.every((p) => p.medicationId === 'med-1'));
  assert.ok(!plan.some((p) => p.date === '2026-10-10' && p.slot === 'afternoon'));
  assert.equal(plan[0].slot, 'night');
});

test('literal HH:MM slots and custom slot times are honoured', () => {
  const plan = planDoseNotifications(
    [reminder({ doses: [{ slot: '06:30', status: 'pending' }, { slot: 'night', status: 'pending' }] })],
    now,
    { slotTimes: { night: '22:15' } }
  );
  const night = plan.find((p) => p.slot === 'night');
  assert.deepEqual([night.at.getHours(), night.at.getMinutes()], [22, 15]);
  const early = plan.find((p) => p.slot === '06:30');
  assert.equal(early.date, '2026-10-11');
});

test('caps the number of notifications and ids round-trip', () => {
  const many = Array.from({ length: 30 }, (_, i) => reminder({ medicationId: `m${i}` }));
  assert.equal(planDoseNotifications(many, now, { maxCount: 10 }).length, 10);
  const first = planDoseNotifications([reminder()], now)[0];
  assert.deepEqual(parseNotificationId(first.id), { medicationId: 'med-1', date: '2026-10-10', slot: 'afternoon' });
  assert.equal(parseNotificationId('water-reminder'), null);
});
