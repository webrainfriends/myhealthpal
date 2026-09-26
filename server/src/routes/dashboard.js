const express = require('express');
const pool = require('../db/pool');
const {
  ORGAN_GROUPS,
  buildOrganSummaries,
  buildCardSummaries,
  organKeyForCustomLabel,
} = require('../services/organHealthService');
const { getAllReferenceRangesByCode } = require('../medications/referenceRangeService');
const { groupTestNames, normalizeTestNameKey } = require('../services/customCardService');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

const RANGE_TO_DAYS = { '7d': 7, '30d': 30, '90d': 90, '6m': 182, '1y': 365, all: null };
// Above this many points, collapse into weekly averages for chart
// readability/performance while the trend endpoint's underlying query still
// scans full-resolution rows (so raw/underlying data stays reachable).
const DENSE_SERIES_THRESHOLD = 60;
// A measurement flagged 'suspected' (very likely the same result re-uploaded
// - see dedupService) or manually confirmed 'confirmed_duplicate' must never
// be counted as if it were an independent data point: every "current state"
// read (latest value, trend, needs-attention) excludes both, leaving only
// 'none'/'confirmed_distinct' rows. Nothing is ever deleted - this only
// affects what gets displayed as live/current.
const EXCLUDE_DUPLICATES_SQL = `hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')`;

// Latest confirmed measurement per pinned parameter, plus whatever the prior
// confirmed value was for that same parameter — only used to describe change
// when both values are on a comparable (normalized) basis.
router.get('/snapshot', async (req, res, next) => {
  try {
    const userId = currentUserId(req);

    const tracked = await pool.query(
      `WITH ranked AS (
         SELECT hm.*, hp.display_name, hp.category, hp.canonical_unit, r.original_filename, r.effective_date,
                row_number() OVER (
                  PARTITION BY hm.health_parameter_id
                  ORDER BY COALESCE(hm.sample_datetime::date, r.effective_date, r.created_at::date) DESC
                ) AS rank
         FROM health_measurements hm
         JOIN reports r ON r.id = hm.report_id
         JOIN health_parameters hp ON hp.id = hm.health_parameter_id
         WHERE r.user_id = $1 AND hm.is_confirmed = true AND ${EXCLUDE_DUPLICATES_SQL}
       )
       SELECT pinned.health_parameter_id, latest.display_name, latest.category, latest.canonical_unit,
              latest.raw_value, latest.normalized_value, latest.normalized_unit, latest.raw_unit,
              latest.qualitative_value, latest.effective_date, latest.original_filename, latest.report_id,
              previous.normalized_value AS previous_normalized_value, previous.qualitative_value AS previous_qualitative_value,
              previous.effective_date AS previous_effective_date
       FROM user_pinned_parameters pinned
       LEFT JOIN ranked latest ON latest.health_parameter_id = pinned.health_parameter_id AND latest.rank = 1
       LEFT JOIN ranked previous ON previous.health_parameter_id = pinned.health_parameter_id AND previous.rank = 2
       WHERE pinned.user_id = $1
       ORDER BY latest.display_name ASC NULLS LAST`,
      [userId]
    );

    const needsAttention = await pool.query(
      `SELECT hm.id, hm.raw_test_name, hm.raw_value, hm.raw_unit, hm.status_flag, hm.needs_review,
              hp.display_name AS parameter_display_name, r.id AS report_id, r.original_filename, r.effective_date
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE r.user_id = $1
         AND (
           (hm.status_flag IS NOT NULL AND lower(hm.status_flag) NOT IN ('normal', 'n'))
           OR hm.needs_review = true
         )
         AND r.ingestion_status IN ('Needs Review', 'Completed')
         AND ${EXCLUDE_DUPLICATES_SQL}
       ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC
       LIMIT 20`,
      [userId]
    );

    const insights = await pool.query(
      `SELECT i.id, i.insight_type, i.title, i.explanation, i.severity, i.generated_at, i.evidence,
              hp.display_name AS parameter_display_name
       FROM insights i
       LEFT JOIN health_parameters hp ON hp.id = i.health_parameter_id
       WHERE i.user_id = $1 AND i.lifecycle_state = 'active'
       ORDER BY i.generated_at DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      trackedMetrics: tracked.rows,
      needsAttention: needsAttention.rows,
      insights: insights.rows,
    });
  } catch (err) {
    next(err);
  }
});

// One card per body-organ group, each read back the way a doctor would:
// how many of that organ's latest results are in range and which ones
// aren't (high/low, and how far) - judged by the report's own printed
// flag/range when it's usable, else the app's own
// standards-based (WHO/ICMR/FDA) general reference range (same source the
// Medications tab scores against) as a fallback. Every group is always
// returned (even with no data yet)
// so a user can see the full picture of what is and isn't being tracked.
router.get('/organs', async (req, res, next) => {
  try {
    const userId = currentUserId(req);

    const { rows } = await pool.query(
      `WITH ranked AS (
         SELECT hm.report_id, hm.raw_value, hm.raw_unit, hm.qualitative_value, hm.status_flag,
                hm.reference_range_raw, hm.numeric_value, hm.normalized_value,
                hp.code, hp.display_name, hp.category, r.effective_date,
                row_number() OVER (
                  PARTITION BY hm.health_parameter_id
                  ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC, hm.created_at DESC
                ) AS rank
         FROM health_measurements hm
         JOIN reports r ON r.id = hm.report_id
         JOIN health_parameters hp ON hp.id = hm.health_parameter_id
         WHERE r.user_id = $1 AND r.ingestion_status IN ('Needs Review', 'Completed') AND ${EXCLUDE_DUPLICATES_SQL}
       )
       SELECT report_id, raw_value, raw_unit, qualitative_value, status_flag,
              reference_range_raw, numeric_value, normalized_value, code, display_name, category, effective_date
       FROM ranked
       WHERE rank = 1`,
      [userId]
    );

    const measurements = rows.map((row) => ({
      code: row.code,
      displayName: row.display_name,
      category: row.category,
      rawValue: row.raw_value,
      rawUnit: row.raw_unit,
      qualitativeValue: row.qualitative_value,
      statusFlag: row.status_flag,
      referenceRangeRaw: row.reference_range_raw,
      numericValue: row.numeric_value,
      normalizedValue: row.normalized_value,
      effectiveDate: row.effective_date,
      reportId: row.report_id,
    }));

    // An unmapped result the custom-card grouping puts in the same kind of
    // group as one of the organ cards (e.g. a CA-125 grouped as "Tumor
    // Markers") joins that card rather than showing up on a second card
    // with the same name - see ORGAN_GROUPS' customLabels. Best-effort: a
    // failure here only means those results stay on their custom card.
    try {
      const classified = await classifyUnmappedMeasurements(userId, req.user.preferred_language);
      for (const { row, classification } of classified) {
        const organKey = organKeyForCustomLabel(classification.label);
        if (!organKey) continue;
        const group = ORGAN_GROUPS.find((g) => g.key === organKey);
        measurements.push(toCardMeasurement(row, group.categories[0]));
      }
    } catch (err) {
      console.warn('Could not fold unmapped results into organ cards', err.message);
    }

    const standardRangesByCode = await getAllReferenceRangesByCode();

    res.json({ organs: buildOrganSummaries(measurements, standardRangesByCode) });
  } catch (err) {
    next(err);
  }
});

function slugifyGroupLabel(label) {
  return `custom:${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other'}`;
}

// One card per AI/heuristic-grouped label (see customCardService.js) for
// every result a lab report contained that the Health Parameter Registry has
// no canonical match for at all (health_parameter_id IS NULL - unlike
// /organs, which can only ever show a registry-mapped result). Scoped by
// report status exactly like /organs (Needs Review or Completed, not
// requiring per-measurement is_confirmed) - a result the user hasn't
// explicitly confirmed yet already shows on an organ card the moment
// extraction finishes, so gating this on confirmation would leave an
// unmapped result invisible for as long as the report sits in Needs
// Review, defeating the entire point: a report's full set of results is
// always represented somewhere on the Dashboard, never silently dropped
// just because nothing recognized the test name.
// Exported for dashboard.test.js: the latest unmapped result per distinct
// raw test name for a user, scoped by report status exactly like /organs
// (see the route comment above for why this deliberately does NOT also
// require hm.is_confirmed).
async function fetchLatestUnmappedMeasurements(userId) {
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT hm.raw_test_name, hm.raw_value, hm.raw_unit, hm.qualitative_value, hm.status_flag,
              hm.reference_range_raw, hm.numeric_value, hm.normalized_value, r.effective_date, r.id AS report_id,
              row_number() OVER (
                PARTITION BY lower(hm.raw_test_name)
                ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC, hm.created_at DESC
              ) AS rank
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       WHERE r.user_id = $1
         AND hm.health_parameter_id IS NULL
         AND ${EXCLUDE_DUPLICATES_SQL}
         AND r.ingestion_status IN ('Needs Review', 'Completed')
     )
     SELECT raw_test_name, raw_value, raw_unit, qualitative_value, status_flag,
            reference_range_raw, numeric_value, normalized_value, effective_date, report_id
     FROM ranked
     WHERE rank = 1`,
    [userId]
  );
  return rows;
}

// Every latest unmapped result paired with its custom-card grouping (see
// customCardService.groupTestNames - cached per test name and language).
async function classifyUnmappedMeasurements(userId, language) {
  const rows = await fetchLatestUnmappedMeasurements(userId);
  const groupByKey = await groupTestNames(
    rows.map((row) => row.raw_test_name),
    language,
    userId
  );
  return rows.map((row) => ({
    row,
    classification: groupByKey.get(normalizeTestNameKey(row.raw_test_name)) || {
      label: 'Other Results',
      icon: '🔬',
      description: null,
    },
  }));
}

function toCardMeasurement(row, category) {
  return {
    // No registry code exists for an unmapped result - the raw test
    // name is the only stable identity it has.
    code: null,
    displayName: row.raw_test_name,
    category,
    rawValue: row.raw_value,
    rawUnit: row.raw_unit,
    qualitativeValue: row.qualitative_value,
    statusFlag: row.status_flag,
    referenceRangeRaw: row.reference_range_raw,
    numericValue: row.numeric_value,
    normalizedValue: row.normalized_value,
    effectiveDate: row.effective_date,
    reportId: row.report_id,
  };
}

router.get('/custom-cards', async (req, res, next) => {
  try {
    const userId = currentUserId(req);

    const classified = await classifyUnmappedMeasurements(userId, req.user.preferred_language);

    const groupsByLabel = new Map();
    const measurements = [];
    for (const { row, classification } of classified) {
      // Already shown on the matching organ card (see /organs).
      if (organKeyForCustomLabel(classification.label)) continue;
      if (!groupsByLabel.has(classification.label)) {
        groupsByLabel.set(classification.label, {
          key: slugifyGroupLabel(classification.label),
          label: classification.label,
          icon: classification.icon,
          categories: [classification.label],
          // Surfaced by buildCardSummaries as `note` - what this group of
          // tests is generally for, so an unmapped result never just shows
          // a bare label with no explanation (see customCardService.js).
          note: classification.description || undefined,
        });
      }
      measurements.push(toCardMeasurement(row, classification.label));
    }

    const cards = buildCardSummaries(measurements, [...groupsByLabel.values()]);

    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

function aggregateWeekly(points) {
  const buckets = new Map();
  for (const point of points) {
    const date = new Date(point.date);
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { date: key, values: [], unit: point.unit });
    if (point.value !== null) buckets.get(key).values.push(point.value);
  }
  return [...buckets.values()].map((bucket) => ({
    date: bucket.date,
    value: bucket.values.length > 0 ? bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length : null,
    unit: bucket.unit,
    aggregated: true,
    pointCount: bucket.values.length,
  }));
}

// Time series for one canonical parameter, date-range filtered and
// pre-aggregated when dense, with every point still traceable back to its
// report.
router.get('/parameters/:code/trend', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const range = req.query.range || '90d';
    const days = Object.prototype.hasOwnProperty.call(RANGE_TO_DAYS, range) ? RANGE_TO_DAYS[range] : 90;

    const parameterResult = await pool.query('SELECT * FROM health_parameters WHERE code = $1', [req.params.code]);
    const parameter = parameterResult.rows[0];
    if (!parameter) return res.status(404).json({ error: 'Unknown parameter code' });

    const { rows } = await pool.query(
      `SELECT hm.id AS measurement_id, hm.report_id, r.original_filename, r.source_type,
              COALESCE(hm.sample_datetime::date, r.effective_date, r.created_at::date) AS date,
              hm.normalized_value, hm.numeric_value, hm.normalized_unit, hm.raw_unit, hm.qualitative_value,
              hm.reference_range_raw
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       WHERE r.user_id = $1 AND hm.health_parameter_id = $2 AND hm.is_confirmed = true AND ${EXCLUDE_DUPLICATES_SQL}
         AND ($3::int IS NULL OR COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) >= CURRENT_DATE - $3::int)
       ORDER BY date ASC`,
      [userId, parameter.id, days]
    );

    const points = rows.map((row) => ({
      date: row.date,
      value: row.normalized_value ?? row.numeric_value,
      unit: row.normalized_unit || row.raw_unit,
      qualitativeValue: row.qualitative_value,
      referenceRange: row.reference_range_raw,
      sourceType: row.source_type,
      reportId: row.report_id,
      reportFilename: row.original_filename,
      measurementId: row.measurement_id,
    }));

    const isDense = points.length > DENSE_SERIES_THRESHOLD && points.every((p) => p.value !== null);

    res.json({
      parameter: { code: parameter.code, displayName: parameter.display_name, canonicalUnit: parameter.canonical_unit },
      range,
      aggregated: isDense,
      points: isDense ? aggregateWeekly(points) : points,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Exposed for dashboard.test.js only - module.exports is still the router
// itself, used identically by app.js.
module.exports.fetchLatestUnmappedMeasurements = fetchLatestUnmappedMeasurements;
