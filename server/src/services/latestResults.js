const pool = require('../db/pool');
const registry = require('../extraction/registry');

// The single definition of "the person's current result for each test", used
// by every dashboard read (organ cards, custom cards, needs-attention) so
// they can't disagree about which value is current.
//
// - Newest result per test. A test can sit under several keys: mapped to a
//   parameter in one report, still unmapped (a spelling the registry didn't
//   know then) in another. An unmapped row is matched to the parameter its
//   name resolves to (unambiguously), or to a mapped row with the same
//   printed name, and only the newest of each identity survives.
// - An undated report counts as the oldest, not as "uploaded today".
// - An unmapped result more than a year older than the person's newest
//   report is dropped: nothing newer replaced it by name, but a single
//   leftover row from years ago isn't "current" either. A mapped result
//   (a test with its own card) is kept however old it is.
// - Where an unmapped row repeats, in the same report, the value of a mapped
//   one (the same figure under two printed names), it is dropped.

const STALE_UNMAPPED_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const DUPLICATE_EXCLUSION = `hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')`;

function timeOf(row) {
  const d = row.effective_date || row.sample_datetime;
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

async function loadCandidateRows(userId) {
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT hm.id, hm.report_id, hm.raw_test_name, hm.raw_value, hm.raw_unit, hm.qualitative_value, hm.status_flag,
              hm.reference_range_raw, hm.numeric_value, hm.normalized_value, hm.normalized_unit, hm.normalization_confidence,
              hm.health_parameter_id, hm.needs_review, hm.sample_datetime,
              hp.code, hp.canonical_unit, hp.category, hp.display_name,
              hp.display_name AS parameter_display_name,
              r.original_filename, r.effective_date, r.date_status, r.report_type, r.source_provider,
              row_number() OVER (
                PARTITION BY COALESCE(hm.health_parameter_id::text, regexp_replace(lower(hm.raw_test_name), '[^a-z0-9]', '', 'g'))
                ORDER BY COALESCE(r.effective_date, hm.sample_datetime::date) DESC NULLS LAST,
                         r.created_at DESC, hm.created_at DESC
              ) AS rank
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE r.user_id = $1
         AND r.ingestion_status IN ('Needs Review', 'Completed')
         AND ${DUPLICATE_EXCLUSION}
     )
     SELECT * FROM ranked WHERE rank = 1`,
    [userId]
  );
  return rows;
}

// -> { rows, supersededHidden, staleHidden }. Each row is a measurement with
// its parameter's columns; a row matched to a parameter by name carries that
// parameter's code/display_name/category/canonical_unit and `has_parameter`
// (its stored health_parameter_id stays null).
async function latestResults(userId, { hideStaleUnmapped = true } = {}) {
  const candidates = await loadCandidateRows(userId);
  const index = await registry.loadTokenIndex();
  const squash = (row) => registry.squash(row.raw_test_name);

  const mappedByName = new Map();
  for (const row of candidates) {
    if (row.health_parameter_id) mappedByName.set(squash(row), row);
  }

  // Resolve every unmapped row's identity once.
  for (const row of candidates) {
    if (row.health_parameter_id) {
      row.identity = row.health_parameter_id;
      continue;
    }
    const sameName = mappedByName.get(squash(row));
    const parameter = sameName
      ? { id: sameName.health_parameter_id, code: sameName.code, display_name: sameName.display_name, category: sameName.category, canonical_unit: sameName.canonical_unit }
      : index.resolve(row.raw_test_name);
    if (parameter) {
      row.identity = parameter.id;
      row.code = parameter.code;
      row.display_name = parameter.display_name;
      row.parameter_display_name = parameter.display_name;
      row.category = parameter.category;
      row.canonical_unit = parameter.canonical_unit;
      row.has_parameter = true;
    } else {
      row.identity = `name:${squash(row)}`;
    }
  }

  const newest = new Map();
  for (const row of candidates) {
    const current = newest.get(row.identity);
    if (!current || timeOf(row) > timeOf(current)) newest.set(row.identity, row);
  }
  let rows = [...newest.values()];
  const supersededHidden = candidates.length - rows.length;

  // The same figure printed under two names in one report: keep the mapped one.
  const mappedFigures = new Set(
    rows
      .filter((r) => r.has_parameter || r.health_parameter_id)
      .filter((r) => r.numeric_value !== null)
      .map((r) => `${r.report_id}|${Number(r.numeric_value)}|${r.reference_range_raw || ''}`)
  );
  const before = rows.length;
  rows = rows.filter((r) => {
    if (r.has_parameter || r.health_parameter_id || r.numeric_value === null) return true;
    return !mappedFigures.has(`${r.report_id}|${Number(r.numeric_value)}|${r.reference_range_raw || ''}`);
  });
  const repeatedHidden = before - rows.length;

  let staleHidden = 0;
  if (hideStaleUnmapped) {
    const latest = rows.reduce((max, r) => Math.max(max, timeOf(r)), -Infinity);
    if (Number.isFinite(latest)) {
      const kept = rows.filter((r) => {
        if (r.has_parameter || r.health_parameter_id) return true;
        return timeOf(r) === -Infinity || latest - timeOf(r) <= STALE_UNMAPPED_DAYS * DAY_MS;
      });
      staleHidden = rows.length - kept.length;
      rows = kept;
    }
  }

  return { rows, supersededHidden: supersededHidden + repeatedHidden, staleHidden };
}

module.exports = { latestResults, DUPLICATE_EXCLUSION };
