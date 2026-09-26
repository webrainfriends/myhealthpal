// Deterministic "check again by" rules for Retest Radar. Every due date here
// is calculated in code from the user's confirmed measurements and their
// confirmed, active medications' onset windows (medication_parameter_links)
// - never asked of an LLM. Each input is plain data so the rules stay
// testable without a database.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// How long after an out-of-range result a recheck is typically worth doing,
// per canonical parameter code. These are general follow-up cadences (e.g.
// HbA1c reflects ~3 months of glucose, vitamin D/B12 need ~12 weeks of
// supplementation to move), not a treatment plan - the app always frames
// the date as "worth discussing with your doctor".
const RETEST_INTERVAL_DAYS = {
  hba1c: 90,
  glucose: 90,
  glucose_fasting: 90,
  glucose_post_prandial: 90,
  total_cholesterol: 180,
  ldl_cholesterol: 180,
  hdl_cholesterol: 180,
  triglycerides: 180,
  vldl_cholesterol: 180,
  non_hdl_cholesterol: 180,
  vitamin_d: 84,
  vitamin_b12: 84,
  iron: 90,
  tibc: 90,
  transferrin_saturation: 90,
  tsh: 42,
  t3: 42,
  t4: 42,
  ft3: 42,
  ft4: 42,
  hemoglobin: 90,
  alt: 60,
  ast: 60,
  ggt: 60,
  creatinine: 90,
  uric_acid: 90,
};
const DEFAULT_ABNORMAL_INTERVAL_DAYS = 90;
const CRITICAL_INTERVAL_DAYS = 14;

// Short, safe, non-numeric weekly actions per parameter and direction.
// Deliberately general lifestyle nudges - no doses, no numbers - so nothing
// here can contradict a clinician's advice.
const MICRO_ACTIONS = {
  vitamin_d: { low: 'Get 15 minutes of morning sunlight on 3 days this week.' },
  vitamin_b12: { low: 'Include eggs, dairy or fortified foods in 3 meals this week.' },
  hba1c: { high: 'Take a 10-minute walk after dinner on 5 days this week.' },
  glucose: { high: 'Swap one sugary drink or sweet for water or fruit each day this week.' },
  glucose_fasting: { high: 'Take a 10-minute walk after dinner on 5 days this week.' },
  glucose_post_prandial: { high: 'Take a 10-minute walk after your largest meal on 5 days this week.' },
  ldl_cholesterol: { high: 'Add a handful of nuts or a bowl of oats instead of a fried snack on 3 days this week.' },
  total_cholesterol: { high: 'Choose grilled or steamed over fried food on 3 days this week.' },
  triglycerides: { high: 'Cut back on sweets and refined carbs at dinner this week.' },
  hdl_cholesterol: { low: 'Fit in 30 minutes of brisk activity on 3 days this week.' },
  hemoglobin: { low: 'Pair an iron-rich food (greens, lentils) with a vitamin C source at 3 meals this week.' },
  iron: { low: 'Pair an iron-rich food (greens, lentils) with a vitamin C source at 3 meals this week.' },
  uric_acid: { high: 'Drink an extra 2 glasses of water each day this week.' },
  alt: { high: 'Skip alcohol and fried food this week.' },
  ast: { high: 'Skip alcohol and fried food this week.' },
  tsh: {
    high: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
    low: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
  },
};
const GENERIC_MICRO_ACTION = 'Note any symptoms this week so you can mention them at your next checkup.';

function isAbnormalFlag(flag) {
  return Boolean(flag) && !/normal/i.test(flag);
}

function isCriticalFlag(flag) {
  return Boolean(flag) && /critical|panic/i.test(flag);
}

function flagDirection(flag) {
  if (!flag) return null;
  if (/low/i.test(flag)) return 'low';
  if (/high/i.test(flag)) return 'high';
  return null;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return toDateString(new Date(d.getTime() + days * MS_PER_DAY));
}

function daysUntil(dateStr, today = new Date()) {
  const d = parseDate(dateStr);
  if (!d) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d.getTime() - todayUtc) / MS_PER_DAY);
}

function microActionFor(parameterCode, flag) {
  const direction = flagDirection(flag);
  const byDirection = MICRO_ACTIONS[parameterCode];
  return (byDirection && direction && byDirection[direction]) || GENERIC_MICRO_ACTION;
}

// Out-of-range latest result -> recheck after the parameter's cadence
// (much sooner if the report flagged it critical).
function detectAbnormalRecheck(latest, parameterCode) {
  if (!latest || !isAbnormalFlag(latest.statusFlag)) return null;
  const critical = isCriticalFlag(latest.statusFlag);
  const interval = critical
    ? CRITICAL_INTERVAL_DAYS
    : RETEST_INTERVAL_DAYS[parameterCode] ?? DEFAULT_ABNORMAL_INTERVAL_DAYS;
  const dueDate = addDays(latest.effectiveDate, interval);
  if (!dueDate) return null;
  return { reason: 'abnormal_recheck', dueDate, critical };
}

// A linked medication started after the latest result -> recheck once its
// typical onset window has passed, to see whether it's working. A result
// already measured after the window opened means the effect has been
// checked, so this no longer fires.
function detectMedicationOnset(latest, medicationLinks) {
  const candidates = [];
  for (const link of medicationLinks || []) {
    const onsetWeeks = link.onsetWeeksMax ?? link.onsetWeeksMin;
    if (onsetWeeks === null || onsetWeeks === undefined || !link.startDate) continue;
    const windowOpens = addDays(link.startDate, Math.round(Number(link.onsetWeeksMin ?? onsetWeeks) * 7));
    const dueDate = addDays(link.startDate, Math.round(Number(onsetWeeks) * 7));
    if (!dueDate) continue;
    if (latest && parseDate(latest.effectiveDate) >= parseDate(windowOpens)) continue;
    candidates.push({ reason: 'medication_onset', dueDate, medicationName: link.medicationName, critical: false });
  }
  candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return candidates[0] || null;
}

// Returns at most one plan candidate for a parameter: the earliest-due of
// the rules that fire, or null when nothing needs rechecking.
function evaluateRetest({ parameterCode, latest, medicationLinks }) {
  const candidates = [detectAbnormalRecheck(latest, parameterCode), detectMedicationOnset(latest, medicationLinks)].filter(
    Boolean
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const chosen = candidates[0];
  return {
    ...chosen,
    lastMeasurementId: latest ? latest.measurementId : null,
    flag: latest ? latest.statusFlag : null,
    microAction: microActionFor(parameterCode, latest ? latest.statusFlag : null),
  };
}

// Monday (UTC) of the week containing `date` - the key a weekly micro-action
// check-in is stored under.
function weekStart(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  return toDateString(new Date(d.getTime() - offset * MS_PER_DAY));
}

// Consecutive checked-in weeks ending at this week (or last week, so a
// streak isn't shown as broken before the user has had a chance to check
// in this week).
function checkinStreak(weekStarts, today = new Date()) {
  const set = new Set(weekStarts.map((w) => String(w).slice(0, 10)));
  let cursor = weekStart(today);
  if (!set.has(cursor)) cursor = addDays(cursor, -7);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

// Which reminder (if any) a plan warrants today. Each kind is sent at most
// once per plan (the caller dedups on plan + kind + due date), so a missed
// day simply rolls into the next matching window.
function reminderKind(dueDate, today = new Date()) {
  const days = daysUntil(dueDate, today);
  if (days === null) return null;
  if (days <= 0) return 'due';
  if (days <= 14) return 'two_weeks';
  return null;
}

// Fills a booking-link template's {test} placeholder. Returns null for a
// template that isn't an http(s) URL, so a misconfiguration never hands the
// app an arbitrary scheme to open.
function bookingUrl(template, testName) {
  if (!template || !/^https?:\/\//i.test(template)) return null;
  return template.split('{test}').join(encodeURIComponent(testName || ''));
}

module.exports = {
  RETEST_INTERVAL_DAYS,
  bookingUrl,
  DEFAULT_ABNORMAL_INTERVAL_DAYS,
  CRITICAL_INTERVAL_DAYS,
  evaluateRetest,
  detectAbnormalRecheck,
  detectMedicationOnset,
  microActionFor,
  daysUntil,
  addDays,
  weekStart,
  checkinStreak,
  reminderKind,
  isAbnormalFlag,
};
