// Groups the Health Parameter Registry's existing `category` taxonomy into
// body-organ groups a non-clinical user recognizes, and turns a user's
// latest measurements into a per-organ "Health Score": the % of their
// tracked results that fall inside the printed reference range. This is a
// deterministic readout of the user's own data (never a diagnosis, and
// never fabricated by a model) - framed plainly so it can't be mistaken for
// clinical judgement.
const ORGAN_GROUPS = [
  { key: 'heart', label: 'Heart & Cholesterol', icon: '❤️', categories: ['lipids'] },
  { key: 'blood', label: 'Blood Health', icon: '🩸', categories: ['hematology'] },
  { key: 'kidneys', label: 'Kidneys', icon: '🫘', categories: ['kidney', 'electrolytes'] },
  { key: 'liver', label: 'Liver', icon: '🔥', categories: ['liver'] },
  { key: 'thyroid', label: 'Thyroid', icon: '🦋', categories: ['thyroid'] },
  { key: 'metabolism', label: 'Metabolism', icon: '⚡', categories: ['metabolic'] },
  { key: 'immune', label: 'Immune System', icon: '🛡️', categories: ['infectious_disease'] },
  { key: 'nutrition', label: 'Nutrition', icon: '🥗', categories: ['vitamins'] },
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
