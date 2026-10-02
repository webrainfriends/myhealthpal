const pool = require('../db/pool');
const { getAllReferenceRangesByCode } = require('../medications/referenceRangeService');
const { evaluateResult, GENERIC_QUALITATIVE_NORMAL, DERIVED_PARAMETERS } = require('./organHealthService');

// The one rule for "does this result need attention", shared by the
// needs-attention list, a report's counts, the timeline's abnormal count and
// the stored summary - so the numbers can't disagree about what is out of
// range. A verdict beats the review flag: `needs_review` is raised for many
// reasons that say nothing about the value (text-parsed rows, a unit spelling
// the registry didn't know), so a result that evaluates as normal is never
// listed because of it.

// Lab templates pre-print rows (a "Trichomonas" line with no result) that
// extraction can pick up as empty / placeholder values.
const PLACEHOLDER_VALUES = new Set(['', '-', '--', '—', 'na', 'n/a', 'nil value', 'not performed', 'not applicable', 'not done']);

function hasReadableResult(row) {
  const value = String(row.raw_value ?? row.qualitative_value ?? '').trim().toLowerCase();
  return !PLACEHOLDER_VALUES.has(value);
}

// An unjudged result that just reads "Absent" / "Nil" / "Not detected" isn't
// worth asking a person to review (and an unmapped template field such as a
// pre-printed "Trichomonas: Absent" can't be judged any other way).
function isNothingFound(row) {
  const text = String(row.qualitative_value ?? row.raw_value ?? '').trim().toLowerCase();
  return GENERIC_QUALITATIVE_NORMAL.has(text);
}

// Row fields are health_measurements columns plus the joined `code`.
function toEvalRow(row) {
  return {
    code: row.code,
    statusFlag: row.status_flag,
    referenceRangeRaw: row.reference_range_raw,
    numericValue: row.numeric_value === null || row.numeric_value === undefined ? null : Number(row.numeric_value),
    normalizedValue: row.normalized_value === null || row.normalized_value === undefined ? null : Number(row.normalized_value),
    qualitativeValue: row.qualitative_value,
    rawValue: row.raw_value,
  };
}

// -> { evaluation, attentionReason } where attentionReason is 'abnormal',
// 'review' (mapped but unjudged), 'unmapped', or null (nothing to show).
function attentionFor(row, standardRange) {
  const evaluation = evaluateResult(toEvalRow(row), standardRange);
  let attentionReason = null;
  if (evaluation.status === 'abnormal') attentionReason = 'abnormal';
  else if (evaluation.status === 'unknown' && row.needs_review && hasReadableResult(row) && !isNothingFound(row)) {
    attentionReason = row.code ? 'review' : 'unmapped';
  }
  return { evaluation, attentionReason };
}

// Tallies for a set of one report's rows.
function tally(rows, standardRangesByCode) {
  const counts = { total: rows.length, abnormal: 0, derivedAbnormal: 0, review: 0 };
  for (const row of rows) {
    const { attentionReason } = attentionFor(row, standardRangesByCode.get(row.code));
    if (attentionReason === 'abnormal') {
      if (DERIVED_PARAMETERS[row.code]) counts.derivedAbnormal += 1;
      else counts.abnormal += 1;
    } else if (attentionReason) counts.review += 1;
  }
  return counts;
}

const COUNT_COLUMNS = `hm.report_id, hm.raw_value, hm.qualitative_value, hm.status_flag, hm.reference_range_raw,
       hm.numeric_value, hm.normalized_value, hm.needs_review, hp.code`;

// Live counts per report (reportId -> counts), judged exactly as the list is.
// Rows flagged as duplicates of another result are left out, like the list.
async function countReports(reportIds) {
  if (reportIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT ${COUNT_COLUMNS}
     FROM health_measurements hm
     LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE hm.report_id = ANY($1) AND hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')`,
    [reportIds]
  );
  const standardRangesByCode = await getAllReferenceRangesByCode();
  const byReport = new Map(reportIds.map((id) => [id, []]));
  for (const row of rows) byReport.get(row.report_id).push(row);
  return new Map([...byReport].map(([id, list]) => [id, tally(list, standardRangesByCode)]));
}

// "16 out of range" in one sentence, consistent with the list.
function describeCounts(counts) {
  const parts = [`Extracted ${counts.total} health parameter${counts.total === 1 ? '' : 's'}.`];
  parts.push(
    counts.abnormal > 0
      ? `${counts.abnormal} outside the reference range.`
      : 'All judged values fall within their reference ranges.'
  );
  if (counts.review > 0) {
    parts.push(`${counts.review} more need${counts.review === 1 ? 's' : ''} manual review (unmapped or low confidence).`);
  }
  return parts.join(' ');
}

module.exports = { toEvalRow, attentionFor, countReports, describeCounts, hasReadableResult, isNothingFound, tally };
