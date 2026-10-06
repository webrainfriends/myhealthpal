// Pure planning for dose-reminder notifications (no Expo imports, so it is
// unit-tested with node --test). Turns /api/medications/reminders/today into
// the one-shot notifications to schedule: today's still-pending doses whose
// time hasn't passed, plus tomorrow's doses (their status isn't known yet, so
// every scheduled slot is assumed due). The app re-plans whenever it opens or a
// dose is logged, so a dose already taken never fires.

// Local clock time for the named slots; a slot can also be a literal "HH:MM".
const SLOT_TIMES = { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '21:00' };
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Resolves a slot to [hour, minute], or null for generic slots ("dose 3")
// that have no clock time and so can't be scheduled.
function slotClock(slot, overrides = {}) {
  const value = overrides[slot] || SLOT_TIMES[slot] || slot;
  const m = HHMM.exec(String(value));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function notificationId(medicationId, date, slot) {
  return `dose|${medicationId}|${date}|${slot}`;
}

function planDoseNotifications(reminders, now = new Date(), { slotTimes = {}, maxCount = 40 } = {}) {
  const today = dateKey(now);
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrow = dateKey(tomorrowDate);
  const plan = [];

  for (const reminder of reminders || []) {
    if (!reminder.active) continue;
    for (const dose of reminder.doses || []) {
      const clock = slotClock(dose.slot, slotTimes);
      if (!clock) continue;

      const days = [];
      if (dose.status === 'pending') days.push([today, now]);
      days.push([tomorrow, tomorrowDate]);

      for (const [date, base] of days) {
        const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), clock[0], clock[1]);
        if (at.getTime() <= now.getTime()) continue;
        plan.push({
          id: notificationId(reminder.medicationId, date, dose.slot),
          medicationId: reminder.medicationId,
          name: reminder.name,
          foodRelation: reminder.foodRelation || null,
          slot: dose.slot,
          date,
          at,
        });
      }
    }
  }

  plan.sort((a, b) => a.at - b.at);
  return plan.slice(0, maxCount);
}

// Reads the ids back out of a delivered notification.
function parseNotificationId(id) {
  const [kind, medicationId, date, slot] = String(id || '').split('|');
  return kind === 'dose' && medicationId && date && slot ? { medicationId, date, slot } : null;
}

module.exports = { SLOT_TIMES, planDoseNotifications, parseNotificationId, notificationId, dateKey };
