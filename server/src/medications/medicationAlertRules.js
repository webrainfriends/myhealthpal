// Deterministic medication alert detectors - the medication-side analog of
// insights/insightRules.js. Every alert here is computed in code from a
// medication's own stored fields plus the current date, never asked of an
// LLM. Pull-model only (no push/background notifications), consistent with
// the rest of the app: these are recomputed whenever the Medications tab is
// loaded, not delivered as a background alert.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 30;
const EXPIRY_URGENT_DAYS = 7;
const REFILL_WARNING_DAYS = 5;
const COURSE_ENDING_WARNING_DAYS = 3;

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// medication.expiry_date/end_date/start_date come back from pg as JS Date
// objects (DATE columns), not strings - format explicitly rather than
// interpolating the Date directly, which would print its full
// "Tue Jun 30 2026 00:00:00 GMT+..." toString().
function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function detectExpiry(medication, today) {
  if (!medication.expiry_date) return null;
  const expiry = new Date(medication.expiry_date);
  if (Number.isNaN(expiry.getTime())) return null;
  const daysUntilExpiry = daysBetween(today, expiry);

  if (daysUntilExpiry < 0) {
    return {
      type: 'expired',
      severity: 'important',
      dueDate: medication.expiry_date,
      title: `${medication.name} has expired`,
      message: `${medication.name} expired on ${formatDate(medication.expiry_date)}. Do not take it - discard it and get a replacement if you still need it.`,
    };
  }
  if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
    return {
      type: 'expiring_soon',
      severity: daysUntilExpiry <= EXPIRY_URGENT_DAYS ? 'attention' : 'info',
      dueDate: medication.expiry_date,
      title: `${medication.name} expires soon`,
      message: `${medication.name} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} (${formatDate(medication.expiry_date)}).`,
    };
  }
  return null;
}

function detectCourseEnd(medication, today) {
  if (!medication.end_date || medication.status !== 'active') return null;
  const end = new Date(medication.end_date);
  if (Number.isNaN(end.getTime())) return null;
  const daysUntilEnd = daysBetween(today, end);

  if (daysUntilEnd < 0) {
    return {
      type: 'course_completed',
      severity: 'info',
      dueDate: medication.end_date,
      title: `${medication.name}'s course is complete`,
      message: `The prescribed course of ${medication.name} ended on ${formatDate(medication.end_date)}. Mark it completed, or start a refill if you're continuing it.`,
    };
  }
  if (daysUntilEnd <= COURSE_ENDING_WARNING_DAYS) {
    return {
      type: 'course_ending',
      severity: 'info',
      dueDate: medication.end_date,
      title: `${medication.name}'s course ends soon`,
      message: `The prescribed course of ${medication.name} ends in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'} (${formatDate(medication.end_date)}).`,
    };
  }
  return null;
}

// Estimates remaining supply from quantity dispensed and daily frequency -
// a simple deterministic depletion model (days elapsed x doses/day), never
// a guess about actual adherence.
function detectRefillNeeded(medication, today) {
  if (medication.status !== 'active') return null;
  if (!medication.quantity_dispensed || !medication.frequency_per_day || !medication.start_date) return null;

  const start = new Date(medication.start_date);
  if (Number.isNaN(start.getTime())) return null;

  const daysElapsed = Math.max(0, daysBetween(start, today));
  const dosesTaken = daysElapsed * Number(medication.frequency_per_day);
  const dosesRemaining = Number(medication.quantity_dispensed) - dosesTaken;
  const daysOfSupplyLeft = dosesRemaining / Number(medication.frequency_per_day);

  if (dosesRemaining <= 0) {
    return {
      type: 'refill_needed',
      severity: 'attention',
      dueDate: null,
      title: `${medication.name} supply is out`,
      message: `Based on the prescribed frequency, your dispensed supply of ${medication.name} has run out - time for a refill.`,
    };
  }
  if (daysOfSupplyLeft <= REFILL_WARNING_DAYS) {
    const roundedDays = Math.max(0, Math.round(daysOfSupplyLeft));
    return {
      type: 'refill_needed',
      severity: 'info',
      dueDate: null,
      title: `${medication.name} refill coming up`,
      message: `Based on the prescribed frequency, about ${roundedDays} day${roundedDays === 1 ? '' : 's'} of ${medication.name} remain - plan a refill soon.`,
    };
  }
  return null;
}

const RULES = [detectExpiry, detectCourseEnd, detectRefillNeeded];

function evaluateMedicationAlerts(medication, today = new Date()) {
  return RULES.map((rule) => rule(medication, today)).filter(Boolean);
}

module.exports = { evaluateMedicationAlerts, detectExpiry, detectCourseEnd, detectRefillNeeded };
