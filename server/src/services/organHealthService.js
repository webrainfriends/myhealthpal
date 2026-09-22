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
// elsewhere). "Activity", "Brain", and "Bones" have no registry category
// yet (this app has no fitness/cognitive/bone-density parameters) - an
// empty categories array is deliberate, not a placeholder to fill in:
// buildOrganSummaries already reports a categories:[] group as 'no_data'
// rather than fabricating a score, exactly like any other group with zero
// tracked results.
const ORGAN_GROUPS = [
  { key: 'diabetes', label: 'Diabetes', icon: '💉', categories: ['diabetes'] },
  { key: 'heart', label: 'Heart, Pressure & Cholesterol', icon: '❤️', categories: ['lipids', 'cardiac'] },
  { key: 'blood', label: 'Blood', icon: '🩸', categories: ['hematology'] },
  { key: 'kidney', label: 'Kidney', icon: '🫘', categories: ['kidney', 'electrolytes'] },
  { key: 'liver_pancreas', label: 'Liver & Pancreas', icon: '🔥', categories: ['liver', 'pancreas'] },
  { key: 'metabolism', label: 'Metabolism & Intestines', icon: '⚡', categories: ['metabolic', 'thyroid'] },
  { key: 'activity', label: 'Activity', icon: '🏃', categories: [] },
  { key: 'brain', label: 'Brain', icon: '🧠', categories: [] },
  { key: 'bones', label: 'Bones', icon: '🦴', categories: [] },
  { key: 'vitamins', label: 'Vitamins', icon: '💊', categories: ['vitamins'] },
];

const NORMAL_FLAGS = new Set(['normal', 'n']);
// Flags that explicitly mean "not evaluated against a range" rather than
// "abnormal" - never counted against the score, same as no flag at all.
const NEUTRAL_FLAGS = new Set(['', 'see note', 'na', 'n/a']);

const RANGE_PATTERN = /(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/;

function parseRange(rangeRaw) {
  if (!rangeRaw) return null;
  const match = RANGE_PATTERN.exec(String(rangeRaw));
  if (!match) return null;
  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

// 'normal' | 'abnormal' | 'unknown' (not enough information to judge -
// excluded from the score rather than guessed at).
function determineResultStatus(row) {
  const flag = String(row.statusFlag || '').trim().toLowerCase();
  if (flag && !NEUTRAL_FLAGS.has(flag)) {
    return NORMAL_FLAGS.has(flag) ? 'normal' : 'abnormal';
  }

  const value = row.normalizedValue ?? row.numericValue;
  const range = parseRange(row.referenceRangeRaw);
  if (value !== null && value !== undefined && range) {
    return value >= range.min && value <= range.max ? 'normal' : 'abnormal';
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
//   effectiveDate, reportId }.
function buildOrganSummaries(rows) {
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
      resultStatus: determineResultStatus(row),
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
