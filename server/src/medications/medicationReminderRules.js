// Pure rules for dose-level medication reminders (no database, so every rule
// is unit-testable - same split as medicationAlertRules.js). A reminder is
// driven only by the medication's own fields: quantity, number of doses,
// schedule and expiry. It never depends on a lab report or parameter link.

const DEFAULT_SLOTS = {
  1: ['morning'],
  2: ['morning', 'night'],
  3: ['morning', 'afternoon', 'night'],
  4: ['morning', 'afternoon', 'evening', 'night'],
};
const MAX_SLOTS = 8;

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const NAMED_TIMES = ['morning', 'afternoon', 'evening', 'night'];
const FOOD_RELATIONS = ['before_food', 'after_food', 'with_food', 'empty_stomach'];
const DEFAULT_FIRST_DOSE = '08:00';
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

// "Every X hours" -> clock times across the day, starting from the first
// explicit HH:MM time if one was given, else 08:00 (e.g. 8h -> 08:00, 16:00, 00:00).
function intervalSlots(intervalHours, times) {
  const interval = Number(intervalHours);
  if (!interval || interval < 1 || interval > 24) return null;
  const first = (times || []).find((t) => HHMM.test(t)) || DEFAULT_FIRST_DOSE;
  const [h, m] = first.split(':').map(Number);
  const count = Math.min(MAX_SLOTS, Math.max(1, Math.floor(24 / interval)));
  const slots = Array.from({ length: count }, (_, i) => {
    const minutes = (h * 60 + m + Math.round(i * interval * 60)) % (24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  });
  return [...new Set(slots)].sort();
}

// The times a medication is taken at each day: an "every X hours" interval
// first, else the explicit times_of_day the person picked (or the prescription
// listed), else derived from frequency_per_day. Null = no schedule.
function dailySlots(medication) {
  if (medication.interval_hours) {
    const slots = intervalSlots(medication.interval_hours, medication.times_of_day);
    if (slots) return slots;
  }
  const explicit = Array.isArray(medication.times_of_day) ? medication.times_of_day.filter(Boolean) : [];
  if (explicit.length > 0) return [...new Set(explicit)].slice(0, MAX_SLOTS);
  const perDay = Math.round(Number(medication.frequency_per_day));
  if (!perDay || perDay < 1) return null;
  if (DEFAULT_SLOTS[perDay]) return DEFAULT_SLOTS[perDay];
  return Array.from({ length: Math.min(perDay, MAX_SLOTS) }, (_, i) => `dose ${i + 1}`);
}

// How many doses the supply covers: an explicit total_doses, else the
// dispensed quantity (one unit per dose).
function totalDoses(medication) {
  if (medication.total_doses) return Number(medication.total_doses);
  if (medication.quantity_dispensed) return Math.floor(Number(medication.quantity_dispensed));
  return null;
}

function countTaken(logs) {
  return logs.filter((l) => l.status === 'taken').length;
}

// Why reminders are (not) running on `today` - null means they are running.
function stopReason(medication, takenCount, todayStr) {
  if (medication.status !== 'active') return 'inactive';
  if (medication.is_confirmed === false) return 'unconfirmed';
  if (medication.reminders_enabled === false) return 'paused';
  if (!dailySlots(medication)) return 'no_schedule';
  const expiry = dateOnly(medication.expiry_date);
  if (expiry && expiry < todayStr) return 'expired';
  const end = dateOnly(medication.end_date);
  if (end && end < todayStr) return 'course_ended';
  const start = dateOnly(medication.start_date);
  if (start && start > todayStr) return 'not_started';
  const total = totalDoses(medication);
  if (total !== null && takenCount >= total) return 'out_of_doses';
  return null;
}

// Today's dose list for one medication. `logs` are all of its dose logs
// (any date); today's decide each slot's status, all of them count towards
// doses used. Skipped doses don't use up supply.
function buildReminder(medication, logs, todayStr) {
  const taken = countTaken(logs);
  const total = totalDoses(medication);
  const dosesRemaining = total === null ? null : Math.max(0, total - taken);
  const reason = stopReason(medication, taken, todayStr);
  const slots = dailySlots(medication) || [];
  const todayLogs = new Map(logs.filter((l) => dateOnly(l.scheduled_date) === todayStr).map((l) => [l.slot, l]));

  let pendingBudget = dosesRemaining === null ? Infinity : dosesRemaining;
  const doses = reason && reason !== 'out_of_doses'
    ? []
    : slots.map((slot) => {
        const log = todayLogs.get(slot);
        if (log) return { slot, status: log.status, loggedAt: log.logged_at || null };
        if (reason === 'out_of_doses' || pendingBudget <= 0) return null;
        pendingBudget -= 1;
        return { slot, status: 'pending', loggedAt: null };
      }).filter(Boolean);

  const expiry = dateOnly(medication.expiry_date);
  const daysToExpiry = expiry ? Math.round((new Date(`${expiry}T00:00:00Z`) - new Date(`${todayStr}T00:00:00Z`)) / 86400000) : null;
  const daysOfSupply = dosesRemaining !== null && slots.length > 0 ? Math.ceil(dosesRemaining / slots.length) : null;

  return {
    medicationId: medication.id,
    name: medication.name,
    active: reason === null,
    stopReason: reason,
    foodRelation: medication.food_relation || null,
    intervalHours: medication.interval_hours ? Number(medication.interval_hours) : null,
    totalDoses: total,
    dosesTaken: taken,
    dosesRemaining,
    daysOfSupplyLeft: daysOfSupply,
    // Reminders stop at whichever comes first: expiry, course end, or the last dose.
    expiryDate: expiry,
    daysToExpiry,
    lastTakenAt: logs.filter((l) => l.status === 'taken').map((l) => l.logged_at).filter(Boolean).sort().pop() || null,
    doses,
    dueCount: doses.filter((d) => d.status === 'pending').length,
    takenCount: doses.filter((d) => d.status === 'taken').length,
    skippedCount: doses.filter((d) => d.status === 'skipped').length,
  };
}

// Slots from the last `days` days before today that were scheduled but never
// logged as taken or skipped - the "missed" signal a caretaker/sponsor sees.
function countMissed(medication, logs, todayStr, days = 3) {
  const slots = dailySlots(medication);
  if (!slots || medication.status !== 'active' || medication.reminders_enabled === false) return 0;
  const start = dateOnly(medication.start_date);
  const end = dateOnly(medication.end_date);
  const expiry = dateOnly(medication.expiry_date);
  const logged = new Set(logs.map((l) => `${dateOnly(l.scheduled_date)}|${l.slot}`));
  let missed = 0;
  for (let i = 1; i <= days; i += 1) {
    const day = addDays(todayStr, -i);
    if ((start && day < start) || (end && day > end) || (expiry && day > expiry)) continue;
    for (const slot of slots) if (!logged.has(`${day}|${slot}`)) missed += 1;
  }
  return missed;
}

// A slot must be one this medication is actually scheduled for.
function isValidSlot(medication, slot) {
  const slots = dailySlots(medication);
  return !!slots && slots.includes(slot);
}

module.exports = { NAMED_TIMES, FOOD_RELATIONS, intervalSlots, dailySlots, totalDoses, stopReason, buildReminder, countMissed, isValidSlot, addDays, dateOnly };
