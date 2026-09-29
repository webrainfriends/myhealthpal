// Groups the Health Parameter Registry's existing `category` taxonomy into
// body-organ groups a non-clinical user recognizes, and turns a user's
// latest measurements into a per-organ readout the way a doctor reads a
// report back to a patient: how many of the tests came back normal, and -
// by name - which ones are outside range, which way (high/low), and by how
// much. It deliberately does NOT headline a percentage: "Kidney 60%" reads
// as "my kidneys work at 60%", when it only ever meant "3 of 5 kidney-
// related results were in range" - a count of tests, not a measure of how
// well the organ itself is working. This is a deterministic readout of the
// user's own data (never a diagnosis, and never fabricated by a model).
// Thyroid strongly regulates metabolic rate, so its category is folded into
// "Metabolism & Intestines" rather than given its own card - this changes
// only which card a thyroid result counts toward, never the category value
// stored on the parameter itself (still 'thyroid', still filterable
// elsewhere). "Brain" and "Bones" have no registry category (this app has
// no cognitive/bone-density parameters), so instead of whole categories
// they claim specific tests by code - the blood tests a doctor actually
// checks for those organs (B12/TSH/HbA1c for brain, vitamin D/calcium/
// phosphorus/ALP for bone), each with a one-line reason it's relevant. A
// test claimed this way still counts on its own home card too: a low B12
// is a Vitamins result AND a Brain-relevant one, the way a doctor reads it.
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
// Every card - populated or not - names the common lab tests that feed it,
// so a card with nothing tracked yet (trackedCount === 0, most often brain/
// bones, which have no registry category at all) still tells the user what
// to go get tested/upload a report for, instead of just sitting empty with
// no explanation. This is deliberately a fixed, curated list (like
// medicationKnowledgeBase.js), not model-generated: it's general medical
// knowledge about what a panel commonly includes, not a judgment about this
// user's own data, so there's no need for an LLM call or a "might be wrong"
// disclaimer beyond the standard one already on every card.
const ORGAN_GROUPS = [
  {
    key: 'diabetes',
    label: 'Diabetes',
    icon: '💉',
    categories: ['diabetes'],
    suggestedTests: ['Fasting Glucose', 'Post-Prandial Glucose', 'HbA1c', 'Fasting Insulin'],
  },
  {
    key: 'heart',
    label: 'Heart, Pressure & Cholesterol',
    icon: '❤️',
    categories: ['lipids', 'cardiac'],
    suggestedTests: ['Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'Triglycerides', 'hs-CRP'],
  },
  {
    key: 'blood',
    label: 'Blood',
    icon: '🩸',
    categories: ['hematology'],
    suggestedTests: ['Complete Blood Count (CBC)', 'Hemoglobin', 'ESR', 'Ferritin/Iron studies'],
  },
  {
    key: 'kidney',
    label: 'Kidney',
    icon: '🫘',
    categories: ['kidney', 'electrolytes', 'urine'],
    suggestedTests: ['Creatinine', 'eGFR', 'BUN', 'Sodium & Potassium', 'Urine Routine & Microscopy'],
  },
  {
    key: 'liver_pancreas',
    label: 'Liver & Pancreas',
    icon: '🔥',
    categories: ['liver', 'pancreas'],
    suggestedTests: ['ALT (SGPT)', 'AST (SGOT)', 'Bilirubin', 'Albumin', 'Lipase or Amylase'],
  },
  {
    key: 'metabolism',
    label: 'Metabolism & Intestines',
    icon: '⚡',
    categories: ['metabolic', 'thyroid'],
    suggestedTests: ['TSH', 'Free T3 / Free T4', 'Fasting Glucose', 'HbA1c'],
  },
  {
    key: 'brain',
    label: 'Brain',
    icon: '🧠',
    categories: [],
    // No registry category measures the brain itself, but these blood tests
    // are the ones a doctor checks for treatable causes of memory, mood and
    // nerve symptoms - so the card correlates them here (each still also
    // counts on its own home card, e.g. B12 on Vitamins).
    codes: {
      vitamin_b12: 'Low B12 can cause memory problems, low mood, and tingling or numbness in hands and feet.',
      vitamin_d: 'Low vitamin D is linked with low mood and fatigue.',
      tsh: 'An under- or overactive thyroid can cause slowed thinking, poor concentration, anxiety or low mood.',
      homocysteine: 'High homocysteine is linked with a higher risk of stroke and memory decline.',
      hba1c: 'Long-term high blood sugar damages small blood vessels and nerves, including in the brain.',
      glucose_fasting: 'Blood sugar that runs too high or too low affects concentration and energy.',
    },
    suggestedTests: ['Vitamin B12', 'Vitamin D', 'TSH (thyroid)', 'Folate', 'Homocysteine', 'Fasting Glucose / HbA1c'],
    note:
      'These are common blood tests doctors use to rule out treatable causes of memory/concentration symptoms (a B12, thyroid, or blood-sugar problem, for example) - ask a doctor which ones fit your situation. Cognitive screening (e.g. MMSE/MoCA) and neuroimaging (MRI/CT) evaluate the brain directly but aren’t lab tests, so they will never appear on this card even once ordered - ask your doctor about those separately.',
  },
  {
    key: 'bones',
    label: 'Bones',
    icon: '🦴',
    categories: [],
    codes: {
      vitamin_d: 'Vitamin D is needed to absorb calcium - low levels weaken bones over time.',
      calcium: 'Calcium is the main mineral in bone; blood levels are kept tightly controlled, so an abnormal value is worth discussing.',
      phosphorus: 'Phosphorus works with calcium to build and harden bone.',
      alp: 'Alkaline phosphatase rises when bone is being broken down or rebuilt quickly (it also comes from the liver).',
    },
    suggestedTests: ['Vitamin D', 'Calcium', 'Phosphorus', 'Alkaline Phosphatase', 'Parathyroid Hormone (PTH)'],
    note:
      'These blood tests reflect bone-related minerals and hormones - ask a doctor which fit your situation. A DEXA bone density scan is the standard test for bone strength itself but isn’t a lab test, so it will never appear on this card even once ordered - ask your doctor about that separately.',
  },
  {
    key: 'vitamins',
    label: 'Vitamins',
    icon: '💊',
    categories: ['vitamins'],
    suggestedTests: ['Vitamin D', 'Vitamin B12', 'Folate', 'Ferritin/Iron'],
  },
  // The groups below cover registry categories no organ card above claims,
  // so a recognized (registry-mapped) result in them - a PSA, a cortisol, an
  // IgE - is never silently dropped from the dashboard. Unlike the organ
  // cards they're `hideWhenEmpty`: an empty "Tumor Markers" card on
  // everyone's dashboard would read as a suggestion to go get screened.
  // `customLabels` are the group labels customCardService gives an
  // unmapped result of the same kind (e.g. a CA-125 the registry doesn't
  // know yet) - routes/dashboard.js folds those into this card too, so the
  // same kind of test never ends up split across two cards.
  {
    key: 'tumor_markers',
    label: 'Tumor Markers',
    icon: '🎗️',
    categories: ['tumor_markers'],
    customLabels: ['Tumor Markers'],
    hideWhenEmpty: true,
    codes: {
      psa_total: 'PSA comes from the prostate. It can rise with an enlarged prostate, infection, recent ejaculation or cycling - not only with cancer.',
      cea: 'CEA is mostly used to follow bowel and some other cancers after diagnosis. Smoking and inflammation can also raise it.',
    },
    suggestedTests: ['PSA (men)', 'CEA', 'CA-125 (women)', 'AFP', 'CA 19-9'],
    note:
      'A tumor marker on its own can’t show or rule out cancer: levels can rise for many harmless reasons, and can be normal when cancer is present. Doctors read them together with an exam and scans - mostly to follow a known condition over time, where the trend matters more than a single value. Discuss any result here with your doctor.',
  },
  {
    key: 'hormones',
    label: 'Hormones',
    icon: '⚗️',
    categories: ['hormones'],
    customLabels: ['Hormones'],
    hideWhenEmpty: true,
  },
  {
    key: 'immunity',
    label: 'Immunity & Infections',
    icon: '🛡️',
    categories: ['immunology', 'infectious_disease'],
    customLabels: ['Allergy & Immune'],
    hideWhenEmpty: true,
  },
];

const NORMAL_FLAGS = new Set(['normal', 'n', 'wnl', 'within normal limits', 'unremarkable', 'within range']);
const ABNORMAL_FLAGS = new Set([
  'high',
  'h',
  'low',
  'l',
  'abnormal',
  'a',
  'critical',
  'critically high',
  'critically low',
  'panic',
  'positive',
  'reactive',
]);

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

const HIGH_FLAGS = new Set(['high', 'h', 'critically high']);
const LOW_FLAGS = new Set(['low', 'l', 'critically low']);
const CRITICAL_FLAGS = new Set(['critical', 'critically high', 'critically low', 'panic']);

// How far past its limit a value has to be before it's described as
// "well above/below" rather than just "slightly": a result a few percent
// over the line (TSH 4.8 vs 4.5, MCHC 31.8 vs 32) is something a doctor
// usually notes and rechecks, whereas one a quarter or more past it
// (creatinine 1.6 vs 1.2, fasting glucose 130 vs 99) is something they'd
// actually act on. Only a readout-framing threshold, not a clinical cut-off.
const MARKED_DEVIATION_PERCENT = 25;

// Where a test has an agreed diagnostic cut-off, that - not the generic %
// rule above - decides "slightly" vs "well" past range. Blood sugar is
// tightly regulated, so a % rule badly understates it: HbA1c 6.8% is only
// ~21% over the 5.6% upper limit, yet it's in the diabetic range, which no
// doctor would call "slightly high". Values between the normal limit and
// the cut-off (the pre-diabetes band) stay 'mild'. ADA/WHO criteria.
const MARKED_HIGH_AT = {
  hba1c: 6.5, // %  - diabetes
  glucose_fasting: 126, // mg/dL - diabetes
  glucose_post_prandial: 200, // mg/dL (2-hour) - diabetes
  glucose: 200, // mg/dL random - diabetes
  glucose_mean: 140, // mg/dL - eAG equivalent of HbA1c 6.5%
};

function numericValueOf(row) {
  const value = row.normalizedValue ?? row.numericValue;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

// The limits a result is judged against: the report's own printed
// "min-max" range when it has one, else the app's standard range.
function limitsFor(row, standardRange) {
  const range = parseRange(row.referenceRangeRaw);
  if (range) return { low: range.min, high: range.max };
  if (standardRange) {
    const low = standardRange.range_low;
    const high = standardRange.range_high;
    return {
      low: low === null || low === undefined ? null : Number(low),
      high: high === null || high === undefined ? null : Number(high),
    };
  }
  return null;
}

// % beyond the limit crossed, relative to that limit (LDL 160 against an
// upper limit of 100 -> 60). Null when there's no usable number to compare.
function deviationPast(limit, value, direction) {
  if (limit === null || value === null || limit === 0) return null;
  const delta = direction === 'high' ? value - limit : limit - value;
  if (delta <= 0) return null;
  return Math.round((delta / Math.abs(limit)) * 100);
}

// Full per-result evaluation: { status, direction, deviationPercent,
// severity }. `status` is 'normal' | 'abnormal' | 'unknown' (not enough
// information to judge - excluded from the counts rather than guessed at).
// For an abnormal result, `direction` is 'high' | 'low' | null (null for a
// qualitative finding like a "Positive" urine protein), and `severity` is
// 'critical' (the lab flagged it critical/panic), 'marked' (at least
// MARKED_DEVIATION_PERCENT past its limit), or 'mild' (anything else,
// including an out-of-range result whose distance can't be measured).
// `standardRange`, when given, is this parameter's row from
// reference_ranges (see referenceRangeService.getAllReferenceRangesByCode)
// - the same WHO/ICMR/FDA-aligned general clinical range the Medications
// tab scores against, used here only as a fallback.
function evaluateResult(row, standardRange) {
  const flag = String(row.statusFlag || '').trim().toLowerCase();
  const value = numericValueOf(row);
  const limits = limitsFor(row, standardRange);

  let status = 'unknown';
  let direction = null;

  // Trust status_flag only when it's a clearly recognized normal/abnormal
  // token. Real extractions produce plenty of flag text that means neither
  // - a placeholder dash a lab prints for "no flag", "See Note", a stray
  // trailing period, a token this list just doesn't happen to know yet.
  // Treating anything unrecognized as "abnormal" (the previous behavior)
  // is exactly the guess this function's own contract says never to make -
  // it silently marked in-range results as out-of-range. An unrecognized
  // flag now falls through to actually comparing the value against the
  // range instead, the same as printing no flag at all.
  if (NORMAL_FLAGS.has(flag)) {
    status = 'normal';
  } else if (ABNORMAL_FLAGS.has(flag)) {
    status = 'abnormal';
    if (HIGH_FLAGS.has(flag)) direction = 'high';
    else if (LOW_FLAGS.has(flag)) direction = 'low';
    else if (value !== null && limits) {
      if (limits.high !== null && value > limits.high) direction = 'high';
      else if (limits.low !== null && value < limits.low) direction = 'low';
    }
  } else if (value !== null && limits && (limits.low !== null || limits.high !== null)) {
    // A report's own printed range isn't always a plain "min-max" - a
    // multi-tier diagnostic band like HbA1c's "Non-Diabetic <5.7 / Pre
    // Diabetic 5.7-6.4 / Diabetic >=6.5" (or no range printed at all,
    // common for a home glucometer reading) can't be parsed by
    // parseRange. Rather than leave every such result stuck at 'unknown',
    // limitsFor falls back to the app's own standard reference range.
    if (limits.low !== null && value < limits.low) {
      status = 'abnormal';
      direction = 'low';
    } else if (limits.high !== null && value > limits.high) {
      status = 'abnormal';
      direction = 'high';
    } else {
      status = 'normal';
    }
  } else {
    const normalValues = QUALITATIVE_NORMAL_VALUES[row.code];
    if (normalValues && row.qualitativeValue) {
      status = normalValues.has(String(row.qualitativeValue).trim().toLowerCase()) ? 'normal' : 'abnormal';
    }
  }

  if (status !== 'abnormal') return { status, direction: null, deviationPercent: null, severity: null };

  const deviationPercent =
    direction && limits ? deviationPast(direction === 'high' ? limits.high : limits.low, value, direction) : null;
  let severity = 'mild';
  const markedAt = MARKED_HIGH_AT[row.code];
  if (CRITICAL_FLAGS.has(flag)) severity = 'critical';
  else if (markedAt !== undefined && direction === 'high' && value !== null) {
    if (value >= markedAt) severity = 'marked';
  } else if (deviationPercent !== null && deviationPercent >= MARKED_DEVIATION_PERCENT) severity = 'marked';

  return { status, direction, deviationPercent, severity };
}

function determineResultStatus(row, standardRange) {
  return evaluateResult(row, standardRange).status;
}

// A card's overall status follows how a doctor triages a report - by the
// worst individual finding, not by what fraction of tests passed. One
// critical or well-out-of-range result deserves attention even if ten
// others are fine, while a couple of results just over the line on a
// 20-test blood count are "keep an eye on it", not an alarm.
function cardStatus(evaluatedCount, outOfRange) {
  if (evaluatedCount === 0) return 'no_data';
  if (outOfRange.length === 0) return 'good';
  if (outOfRange.some((p) => p.severity === 'critical' || p.severity === 'marked')) return 'attention';
  return 'watch';
}

const SEVERITY_RANK = { critical: 0, marked: 1, mild: 2 };
const RESULT_ORDER = { abnormal: 0, normal: 1, unknown: 2 };

const STATUS_LABELS = {
  good: 'Good',
  watch: 'Keep an eye on it',
  attention: 'Needs attention',
  no_data: 'No data yet',
};

// Turns `rows` (one row per parameter, already reduced to each parameter's
// latest measurement - see buildOrganSummaries below for the exact row
// shape) into one scored card per entry in `groups`, each shaped
// { key, categories }: `categories` are the values of `row.category` this
// card claims (so callers can build 1-category-per-card ad-hoc groups just
// as well as ORGAN_GROUPS' many-categories-per-card ones). Kept generic
// (not organ-specific) so it also backs customCardService's AI/heuristic-
// grouped cards for parameters no organ group covers at all - a card built
// this way is never fabricated data, only a different grouping of the
// user's own already-extracted results.
function buildCardSummaries(rows, groups, standardRangesByCode = new Map()) {
  const rowsByCategory = new Map();
  for (const row of rows) {
    const list = rowsByCategory.get(row.category) || [];
    list.push(row);
    rowsByCategory.set(row.category, list);
  }

  const rowsByCode = new Map(rows.filter((row) => row.code).map((row) => [row.code, row]));

  return groups.map((group) => {
    const categoryRows = group.categories.flatMap((category) => rowsByCategory.get(category) || []);
    // A group can also claim specific tests by code, on top of (or instead
    // of) whole categories - see ORGAN_GROUPS' Brain/Bones entries.
    const codeRows = Object.keys(group.codes || {})
      .map((code) => rowsByCode.get(code))
      .filter((row) => row && !categoryRows.includes(row));
    const groupRows = [...categoryRows, ...codeRows];
    const parameters = groupRows.map((row) => {
      const standardRange = standardRangesByCode.get(row.code);
      const evaluation = evaluateResult(row, standardRange);
      return {
        code: row.code,
        displayName: row.displayName,
        value: row.qualitativeValue || row.rawValue,
        unit: row.rawUnit || null,
        statusFlag: row.statusFlag || null,
        // Both surfaced (not just whichever determineResultStatus ends up
        // using) so the client can show the client a "why" for the status -
        // the printed range when there is one, else the general standard
        // range used as the fallback.
        referenceRangeRaw: row.referenceRangeRaw || null,
        standardRange: standardRange
          ? { low: standardRange.range_low, high: standardRange.range_high, source: standardRange.source }
          : null,
        resultStatus: evaluation.status,
        // 'high' | 'low' | null, and how far past its limit (in % of that
        // limit) - so the client can say "LDL well above range" rather
        // than just "out of range".
        direction: evaluation.direction,
        deviationPercent: evaluation.deviationPercent,
        severity: evaluation.severity,
        effectiveDate: row.effectiveDate || null,
        reportId: row.reportId || null,
        // Why this test is on this card, in plain words - how a doctor
        // would connect it to the organ ("Low B12 can cause memory
        // problems..."). Only for tests a group claims by code.
        relevance: group.codes?.[row.code] || null,
      };
    });

    const determinable = parameters.filter((p) => p.resultStatus !== 'unknown');
    const normalCount = determinable.filter((p) => p.resultStatus === 'normal').length;
    const outOfRange = determinable
      .filter((p) => p.resultStatus === 'abnormal')
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          (b.deviationPercent ?? -1) - (a.deviationPercent ?? -1) ||
          a.displayName.localeCompare(b.displayName)
      )
      .map(({ code, displayName, direction, deviationPercent, severity }) => ({
        code,
        displayName,
        direction,
        deviationPercent,
        severity,
      }));
    // Share of evaluated results in range. Kept in the payload for API
    // compatibility only - the app never headlines it, since a bare "60%"
    // on an organ card reads as how well the organ works (see this file's
    // header comment). The counts and outOfRange list are what's shown.
    const scorePercent = determinable.length > 0 ? Math.round((normalCount / determinable.length) * 100) : null;
    const status = cardStatus(determinable.length, outOfRange);

    return {
      key: group.key,
      label: group.label,
      icon: group.icon,
      scorePercent,
      status,
      statusLabel: STATUS_LABELS[status],
      trackedCount: parameters.length,
      evaluatedCount: determinable.length,
      normalCount,
      attentionCount: determinable.length - normalCount,
      // Out-of-range results, most concerning first - what a doctor would
      // actually name when reading the report back ("your LDL is high").
      outOfRange,
      // Out-of-range results first (most concerning first, same order as
      // outOfRange), then normal ones, then any that couldn't be evaluated -
      // the order a doctor goes through a report, and the same order the
      // dashboard card names them in.
      parameters: parameters.sort(
        (a, b) =>
          RESULT_ORDER[a.resultStatus] - RESULT_ORDER[b.resultStatus] ||
          (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
          (b.deviationPercent ?? -1) - (a.deviationPercent ?? -1) ||
          a.displayName.localeCompare(b.displayName)
      ),
      // What lab tests commonly feed this card - always present (not just
      // when empty) so a populated card can still answer "what else could I
      // track here". See ORGAN_GROUPS' comment for why this is curated
      // rather than model-generated. Absent (undefined) for an ad-hoc
      // AI/heuristic-grouped card (see customCardService.js) - there is no
      // fixed, general answer to "what feeds a card the app itself named
      // on the fly".
      suggestedTests: group.suggestedTests || undefined,
      note: group.note || undefined,
    };
  });
}

// `rows` is one row per parameter (already reduced to each parameter's
// latest measurement, e.g. by the caller's SQL) with at least:
// { code, displayName, category, rawValue, rawUnit, qualitativeValue,
//   statusFlag, referenceRangeRaw, numericValue, normalizedValue,
//   effectiveDate, reportId }. `standardRangesByCode` (optional, default
// none) is a Map<parameterCode, reference_ranges row> - see
// referenceRangeService.getAllReferenceRangesByCode - used as a fallback
// when a row's own report didn't print a usable flag/range.
// A `hideWhenEmpty` group (see ORGAN_GROUPS) is left out entirely when the
// user has nothing tracked in it.
function buildOrganSummaries(rows, standardRangesByCode = new Map()) {
  return buildCardSummaries(rows, ORGAN_GROUPS, standardRangesByCode).filter(
    (card, index) => !ORGAN_GROUPS[index].hideWhenEmpty || card.trackedCount > 0
  );
}

// Map<lowercased custom-card label, organ group key> - which customCardService
// labels an organ card absorbs (see ORGAN_GROUPS' customLabels).
const ORGAN_KEY_BY_CUSTOM_LABEL = new Map(
  ORGAN_GROUPS.flatMap((group) => (group.customLabels || []).map((label) => [label.toLowerCase(), group.key]))
);

function organKeyForCustomLabel(label) {
  return ORGAN_KEY_BY_CUSTOM_LABEL.get(String(label || '').trim().toLowerCase()) || null;
}

module.exports = {
  ORGAN_GROUPS,
  buildOrganSummaries,
  buildCardSummaries,
  determineResultStatus,
  evaluateResult,
  organKeyForCustomLabel,
  parseRange,
};
