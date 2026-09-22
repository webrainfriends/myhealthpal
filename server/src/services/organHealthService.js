// Groups the Health Parameter Registry's existing `category` taxonomy into
// body-organ groups a non-clinical user recognizes, and turns a user's
// latest measurements into a per-organ "Health Score": the % of their
// tracked results that fall inside the printed reference range. This is a
// deterministic readout of the user's own data (never a diagnosis, and
// never fabricated by a model) - framed plainly so it can't be mistaken for
// clinical judgement.
// Thyroid strongly regulates metabolic rate, so its category is folded into
// "Metabolism & Intestines" rather than given its own card - this changes
// only which card a thyroid result counts toward, never the category value
// stored on the parameter itself (still 'thyroid', still filterable
// elsewhere). "Brain" and "Bones" have no registry category yet (this app
// has no cognitive/bone-density parameters) - an empty categories array is
// deliberate, not a placeholder to fill in: buildOrganSummaries already
// reports a categories:[] group as 'no_data' rather than fabricating a
// score, exactly like any other group with zero tracked results.
// Urinalysis (the 'urine' category) is folded into the Kidney card the same
// way - a urine complete analysis is clinically part of a renal workup, and
// it keeps the dashboard's card list exactly as already decided rather than
// unilaterally adding a new one.
// Physical activity (steps/exercise/stand) is deliberately NOT an organ
// group here at all - it isn't a lab result, has no reference range, and is
// never "abnormal" the way this file's score-against-a-range model assumes.
// It's tracked in its own activity_logs table and rendered as its own
// dashboard section (see src/routes/activity.js and the mobile Activity
// screen), never mixed into this scoring system or into "Needs attention".
const ORGAN_GROUPS = [
  { key: 'diabetes', label: 'Diabetes', icon: '💉', categories: ['diabetes'] },
  { key: 'heart', label: 'Heart, Pressure & Cholesterol', icon: '❤️', categories: ['lipids', 'cardiac'] },
  { key: 'blood', label: 'Blood', icon: '🩸', categories: ['hematology'] },
  { key: 'kidney', label: 'Kidney', icon: '🫘', categories: ['kidney', 'electrolytes', 'urine'] },
  { key: 'liver_pancreas', label: 'Liver & Pancreas', icon: '🔥', categories: ['liver', 'pancreas'] },
  { key: 'metabolism', label: 'Metabolism & Intestines', icon: '⚡', categories: ['metabolic', 'thyroid'] },
  { key: 'brain', label: 'Brain', icon: '🧠', categories: [] },
  { key: 'bones', label: 'Bones', icon: '🦴', categories: [] },
  { key: 'vitamins', label: 'Vitamins', icon: '💊', categories: ['vitamins'] },
];

const NORMAL_FLAGS = new Set(['normal', 'n']);
// Flags that explicitly mean "not evaluated against a range" rather than
// "abnormal" - never counted against the score, same as no flag at all.
const NEUTRAL_FLAGS = new Set(['', 'see note', 'na', 'n/a']);

// Anchored to the whole (trimmed) string, with only non-digit characters
// (e.g. a trailing unit) allowed after the range - a plain "13.0-17.0" or
// "0.4-4.5 uIU/mL" matches, but a multi-tier diagnostic band like HbA1c's
// "Non-Diabetic Level: < 5.7% Pre Diabetic 5.7-6.4% Diabetic Level: >=6.5%"
// does not: an unanchored match would silently grab the first number pair
// it finds (here, the Pre-Diabetic tier) as if it were the normal range,
// which is worse than not parsing it at all. Text shaped like that falls
// through to the standards-based fallback in determineResultStatus instead.
const RANGE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*[^\d]*$/;

function parseRange(rangeRaw) {
  if (!rangeRaw) return null;
  const match = RANGE_PATTERN.exec(String(rangeRaw));
  if (!match) return null;
  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

// Most of a urine complete analysis is qualitative (Colour, Clarity, a
// dipstick's Negative/Nil readings, ...), so neither the numeric-range
// parse above nor a standards-table lookup applies - there's no "13-17" to
// parse and no WHO/ICMR/FDA table for "is the urine clear". Deliberately
// narrow: only parameters where a lab's "normal" phrasing is well-known and
// unambiguous get an entry, so a value this never expects to see (e.g.
// "Positive", "1+", "Turbid") correctly falls through to 'unknown' rather
// than being guessed at.
const QUALITATIVE_NORMAL_VALUES = {
  urine_colour: new Set(['pale yellow', 'light yellow', 'yellow', 'straw', 'straw yellow']),
  urine_clarity: new Set(['clear']),
  urine_glucose: new Set(['nil', 'negative', 'absent', 'none']),
  urine_protein: new Set(['nil', 'negative', 'absent', 'none']),
  urine_nitrite: new Set(['negative', 'nil']),
  urine_ketone: new Set(['negative', 'nil']),
  urine_bile: new Set(['absent', 'nil', 'negative']),
  urine_urobilinogen: new Set(['normal']),
  urine_blood: new Set(['negative', 'nil']),
  urine_crystals: new Set(['nil', 'absent', 'none']),
  urine_pathological_cast: new Set(['nil', 'absent', 'none']),
  urine_bacteria: new Set(['nil', 'absent', 'none']),
  urine_yeast: new Set(['nil', 'absent', 'none']),
  urine_mucus: new Set(['absent', 'nil', 'none']),
};

// 'normal' | 'abnormal' | 'unknown' (not enough information to judge -
// excluded from the score rather than guessed at). `standardRange`, when
// given, is this parameter's row from reference_ranges (see
// referenceRangeService.getAllReferenceRangesByCode) - the same
// WHO/ICMR/FDA-aligned general clinical range the Medications tab scores
// against, used here only as a fallback.
function determineResultStatus(row, standardRange) {
  const flag = String(row.statusFlag || '').trim().toLowerCase();
  if (flag && !NEUTRAL_FLAGS.has(flag)) {
    return NORMAL_FLAGS.has(flag) ? 'normal' : 'abnormal';
  }

  const value = row.normalizedValue ?? row.numericValue;
  const range = parseRange(row.referenceRangeRaw);
  if (value !== null && value !== undefined && range) {
    return value >= range.min && value <= range.max ? 'normal' : 'abnormal';
  }

  // A report's own printed range isn't always a plain "min-max" - a
  // multi-tier diagnostic band like HbA1c's "Non-Diabetic <5.7 / Pre
  // Diabetic 5.7-6.4 / Diabetic >=6.5" (or no range printed at all, common
  // for a home glucometer reading) can't be parsed by the regex above.
  // Rather than leave every such result stuck at 'unknown', fall back to
  // the app's own standard reference range for this parameter.
  if (value !== null && value !== undefined && standardRange) {
    const { range_low: low, range_high: high } = standardRange;
    if (low !== null && low !== undefined && value < low) return 'abnormal';
    if (high !== null && high !== undefined && value > high) return 'abnormal';
    return 'normal';
  }

  const normalValues = QUALITATIVE_NORMAL_VALUES[row.code];
  if (normalValues && row.qualitativeValue) {
    return normalValues.has(String(row.qualitativeValue).trim().toLowerCase()) ? 'normal' : 'abnormal';
  }

  return 'unknown';
}

function scoreToStatus(scorePercent) {
  if (scorePercent === null) return 'no_data';
  if (scorePercent >= 90) return 'good';
  if (scorePercent >= 70) return 'watch';
  return 'attention';
}

const STATUS_LABELS = {
  good: 'Good',
  watch: 'Keep an eye on it',
  attention: 'Needs attention',
  no_data: 'No data yet',
};

// `rows` is one row per parameter (already reduced to each parameter's
// latest measurement, e.g. by the caller's SQL) with at least:
// { code, displayName, category, rawValue, rawUnit, qualitativeValue,
//   statusFlag, referenceRangeRaw, numericValue, normalizedValue,
//   effectiveDate, reportId }. `standardRangesByCode` (optional, default
// none) is a Map<parameterCode, reference_ranges row> - see
// referenceRangeService.getAllReferenceRangesByCode - used as a fallback
// when a row's own report didn't print a usable flag/range.
function buildOrganSummaries(rows, standardRangesByCode = new Map()) {
  const rowsByCategory = new Map();
  for (const row of rows) {
    const list = rowsByCategory.get(row.category) || [];
    list.push(row);
    rowsByCategory.set(row.category, list);
  }

  return ORGAN_GROUPS.map((group) => {
    const groupRows = group.categories.flatMap((category) => rowsByCategory.get(category) || []);
    const parameters = groupRows.map((row) => ({
      code: row.code,
      displayName: row.displayName,
      value: row.qualitativeValue || row.rawValue,
      unit: row.rawUnit || null,
      statusFlag: row.statusFlag || null,
      resultStatus: determineResultStatus(row, standardRangesByCode.get(row.code)),
      effectiveDate: row.effectiveDate || null,
      reportId: row.reportId || null,
    }));

    const determinable = parameters.filter((p) => p.resultStatus !== 'unknown');
    const normalCount = determinable.filter((p) => p.resultStatus === 'normal').length;
    const scorePercent = determinable.length > 0 ? Math.round((normalCount / determinable.length) * 100) : null;
    const status = scoreToStatus(scorePercent);

    return {
      key: group.key,
      label: group.label,
      icon: group.icon,
      scorePercent,
      status,
      statusLabel: STATUS_LABELS[status],
      trackedCount: parameters.length,
      normalCount,
      attentionCount: determinable.length - normalCount,
      parameters: parameters.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    };
  });
}

module.exports = { ORGAN_GROUPS, buildOrganSummaries, determineResultStatus, parseRange };
