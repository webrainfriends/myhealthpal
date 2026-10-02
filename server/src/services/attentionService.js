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
// Culture / microscopy wording for a clean result ("No growth after 48 hours
// of incubation", "Sterile", "No organism isolated"). A text that also names a
// positive finding is never treated as clean.
const NEGATIVE_FINDING = new RegExp(
  [
    '^no (significant |bacterial |microbial |fungal |pathogenic |organism |bacterial or fungal )?growth\\b',
    '^no (significant )?(organisms?|pathogens?|bacteria|parasites?|ova|cysts?|yeast|casts?|crystals?)\\b.*\\b(isolated|seen|detected|found|present|identified)\\b',
    '^(sterile|not isolated|negative for\\b.*)$',
  ].join('|')
);
const POSITIVE_FINDING = /(\bgrowth of\b|\bisolated:|\bpositive\b|>\s*10\s*\^|\bcfu\b.*\b\d{3,}\b|\bpredominant)/;

function isNothingFoundText(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return false;
  if (GENERIC_QUALITATIVE_NORMAL.has(text)) return true;
  return NEGATIVE_FINDING.test(text) && !POSITIVE_FINDING.test(text);
}

function isNothingFound(row) {
  return isNothingFoundText(row.qualitative_value ?? row.raw_value);
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
  if (counts.derivedAbnormal > 0) {
    parts.push(`${counts.derivedAbnormal} calculated value${counts.derivedAbnormal === 1 ? '' : 's'} (derived from another test) also outside range.`);
  }
  if (counts.review > 0) {
    parts.push(`${counts.review} more need${counts.review === 1 ? 's' : ''} manual review (unmapped or low confidence).`);
  }
  return parts.join(' ');
}

// The one-line summary stored when a report was uploaded counts flags as they
// were then, and goes stale as soon as results are re-judged. Where it is the
// plain lab summary, the live counts replace it; summaries that say something
// else (an activity / glucose import note, an imaging report) are left alone.
const PLAIN_LAB_SUMMARY = /^Extracted \d+ health parameter/;

function isPlainLabSummary(text) {
  return Boolean(text) && PLAIN_LAB_SUMMARY.test(text) && !/Imported /.test(text);
}

function liveSummary(report, counts) {
  return counts && isPlainLabSummary(report && report.generated_summary)
    ? describeCounts(counts)
    : (report && report.generated_summary) || null;
}

module.exports = { toEvalRow, attentionFor, countReports, describeCounts, liveSummary, isPlainLabSummary, isNothingFoundText, hasReadableResult, isNothingFound, tally };
