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
const THYROID_MEDICINE_TIMING = {
  high: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
  low: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
};
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
  vldl_cholesterol: { high: 'Cut back on sweets and refined carbs at dinner this week.' },
  non_hdl_cholesterol: { high: 'Add a handful of nuts or a bowl of oats instead of a fried snack on 3 days this week.' },
  ggt: { high: 'Skip alcohol and fried food this week.' },
  creatinine: { high: 'Drink water regularly through the day this week, and skip heavy gym sessions the day before your test.' },
  tsh: {
    high: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
    low: 'Take your thyroid medicine at the same time every morning this week, if you have one.',
  },
  ft3: THYROID_MEDICINE_TIMING,
  ft4: THYROID_MEDICINE_TIMING,
  t3: THYROID_MEDICINE_TIMING,
  t4: THYROID_MEDICINE_TIMING,
};
// The fallback for any parameter/direction without its own entry above. Not
// a symptom nudge for its own sake: keeping routine steady until the retest
// is what makes the next result comparable with this one.
const GENERIC_MICRO_ACTION =
  'Keep your usual diet, activity and medicines steady until the retest so the new result is comparable, and note any symptoms to mention at your next checkup.';

// Test-day preparation per parameter: which panel the lab will call it, and
// the practical steps that most affect whether the result is reliable.
// General guidance only - no doses, nothing that overrides a lab's or
// doctor's own instructions (every tip list ends with that caveat).
const FASTING_8H = 'Fast for 8-10 hours before the test (plain water is fine).';
const LIPID_PREP = {
  panel: 'lipid profile',
  tips: [
    'Fast for 9-12 hours before the test (plain water is fine) - or ask the lab whether a non-fasting lipid test is acceptable.',
    'Avoid alcohol for 24 hours before the test.',
    'Eat normally in the days before; a very unusual diet skews the result.',
  ],
};
const GLUCOSE_PREP = { panel: 'fasting blood glucose', tips: [FASTING_8H, 'Do not take sugary drinks or snacks the morning of the test.'] };
const THYROID_PREP = {
  panel: 'thyroid profile',
  tips: [
    'No fasting needed, but go at the same time of day as your last test (levels shift through the day).',
    'If you take thyroid medicine, ask your doctor whether to take it after the blood draw that morning.',
  ],
};
const IRON_PREP = {
  panel: 'iron studies',
  tips: [
    'Go in the morning after an overnight fast - iron levels are highest then and drop through the day.',
    'Ask your doctor whether to pause iron supplements for 24 hours before the test.',
  ],
};
const LIVER_PREP = { panel: 'liver function test', tips: ['Avoid alcohol for 48 hours before the test.', 'Skip heavy exercise the day before; it can raise liver enzymes.'] };
const KIDNEY_PREP = {
  panel: 'kidney function test',
  tips: ['Stay well hydrated, and skip heavy exercise and a very high-protein meal the day before.'],
};
const TEST_PREP = {
  ldl_cholesterol: LIPID_PREP,
  hdl_cholesterol: LIPID_PREP,
  total_cholesterol: LIPID_PREP,
  triglycerides: LIPID_PREP,
  vldl_cholesterol: LIPID_PREP,
  non_hdl_cholesterol: LIPID_PREP,
  glucose_fasting: GLUCOSE_PREP,
  glucose: GLUCOSE_PREP,
  glucose_post_prandial: {
    panel: 'post-prandial blood glucose',
    tips: ['Eat your usual meal, then have the blood drawn exactly 2 hours after you start eating.', 'Do not eat or drink anything but water in between.'],
  },
  hba1c: { panel: 'HbA1c', tips: ['No fasting needed - HbA1c reflects the past ~3 months, so you can test at any time of day.'] },
  tsh: THYROID_PREP,
  ft3: THYROID_PREP,
  ft4: THYROID_PREP,
  t3: THYROID_PREP,
  t4: THYROID_PREP,
  iron: IRON_PREP,
  tibc: IRON_PREP,
  transferrin_saturation: IRON_PREP,
  hemoglobin: { panel: 'complete blood count', tips: ['No fasting needed. Stay hydrated so the blood draw is easy.'] },
  vitamin_d: { panel: 'vitamin D (25-OH)', tips: ['No fasting needed.', 'If you take a vitamin D supplement, take it as usual unless your doctor says otherwise.'] },
  vitamin_b12: { panel: 'vitamin B12', tips: ['No fasting needed, but avoid taking a B12 supplement or multivitamin on the morning of the test.'] },
  alt: LIVER_PREP,
  ast: LIVER_PREP,
  ggt: LIVER_PREP,
  creatinine: KIDNEY_PREP,
  uric_acid: { panel: 'uric acid', tips: [FASTING_8H, 'Avoid alcohol and a heavy, rich meal the day before.'] },
};
const PREP_CAVEAT = "Follow your lab's or doctor's instructions if they differ.";

// Test-day tips for a plan: the parameter's panel and preparation steps,
// plus - for a plan opened because a medicine's effect is due to be checked -
// what that check is for. `plan` is { parameterCode, reason, medicationName }.
function prepFor(plan) {
  const base = (plan && TEST_PREP[plan.parameterCode]) || null;
  const tips = base ? [...base.tips] : [];
  if (plan && plan.reason === 'medication_onset' && plan.medicationName) {
    tips.unshift(
      `This retest is timed to see how ${plan.medicationName} is working - keep taking it as prescribed unless your doctor says otherwise.`
    );
  }
  if (tips.length > 0) tips.push(PREP_CAVEAT);
  return { panel: base ? base.panel : null, tips };
}

// Same meaning as the insight engine's check: "Normal"-style and
// nothing-found wordings (Sufficient, Negative, Absent...) aren't abnormal.
const { isAbnormalFlag } = require('../insights/insightRules');

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
// `{test}` is the parameter's name; `{panel}` is the panel a lab lists it
// under (a lipid result searches for "lipid profile", not "LDL cholesterol"),
// falling back to the test name when the parameter has no known panel.
function bookingUrl(template, testName, panel = null) {
  if (!template || !/^https?:\/\//i.test(template)) return null;
  return template
    .split('{panel}')
    .join(encodeURIComponent(panel || testName || ''))
    .split('{test}')
    .join(encodeURIComponent(testName || ''));
}

// Everything the app needs to book a plan's test, in one place: the link,
// the panel to ask for, and the one prep tip worth showing next to the
// button. A medicine-onset plan books the linked parameter's panel (it is a
// lab value being rechecked), never the medicine's name.
function bookingFor(template, plan) {
  const prep = prepFor(plan);
  const testName = plan.parameterDisplayName;
  return {
    url: bookingUrl(template, testName, prep.panel),
    label: `Book ${prep.panel || testName}`,
    panel: prep.panel || testName || null,
    prepNote: prep.tips[0] || null,
  };
}

module.exports = {
  RETEST_INTERVAL_DAYS,
  bookingUrl,
  bookingFor,
  prepFor,
  TEST_PREP,
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
