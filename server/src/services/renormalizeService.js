const pool = require('../db/pool');
const config = require('../config');
const { normalizeCandidate } = require('../extraction/normalizationService');
const { supersedeInsightsForMeasurement, runForMeasurement } = require('../insights/insightService');
const { refreshSummaryForReport } = require('../extraction/reportNarrativeService');
const { countReports, liveSummary } = require('./attentionService');

// Re-runs normalization (registry matching, unit handling, value
// classification) over results that were saved before those rules were
// fixed, so every dashboard card / list that reads these columns shows the
// corrected values. No AI is called: the inputs are the raw fields exactly as
// extracted (raw_test_name, raw_value, raw_unit), which are never changed.
//
// Skipped on purpose:
//   - results a person corrected by hand (a measurement_corrections row) -
//     their mapping and values are theirs;
//   - raw_*, status_flag, reference_range_raw, is_confirmed, duplicate_status,
//     report_id - not derived data.
// Idempotent: a row is written only when the recomputed values differ.

const DERIVED_COLUMNS = [
  'health_parameter_id',
  'value_type',
  'comparator',
  'numeric_value',
  'qualitative_value',
  'normalized_unit',
  'normalized_value',
  'normalization_confidence',
  'ambiguous_candidate_ids',
  'needs_review',
  'panel_category',
];
const NUMERIC_COLUMNS = new Set(['numeric_value', 'normalized_value', 'normalization_confidence']);
const BATCH_SIZE = 500;

function sameValue(column, a, b) {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === null || y === null) return x === y;
  if (NUMERIC_COLUMNS.has(column)) return Math.abs(Number(x) - Number(y)) < 1e-9;
  if (column === 'ambiguous_candidate_ids') return JSON.stringify(x) === JSON.stringify(y);
  return String(x) === String(y);
}

async function renormalize({ dryRun = true, userId = null, reportId = null, log = () => {} } = {}) {
  const stats = {
    scanned: 0,
    skippedEdited: 0,
    changed: 0,
    remapped: 0,
    unitChanged: 0,
    reviewCleared: 0,
    reviewAdded: 0,
    insightsRefreshed: 0,
    reportsRefreshed: 0,
    summariesRefreshed: 0,
  };
  const changedReports = new Set();
  const insightWork = [];

  let lastId = null;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT hm.*, EXISTS (SELECT 1 FROM measurement_corrections mc WHERE mc.measurement_id = hm.id) AS edited
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       WHERE ($1::uuid IS NULL OR hm.id > $1)
         AND ($2::uuid IS NULL OR r.user_id = $2)
         AND ($3::uuid IS NULL OR hm.report_id = $3)
       ORDER BY hm.id
       LIMIT ${BATCH_SIZE}`,
      [lastId, userId, reportId]
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      stats.scanned += 1;
      if (row.edited) {
        stats.skippedEdited += 1;
        continue;
      }

      const confidence = row.extraction_confidence === null ? null : Number(row.extraction_confidence);
      const next = await normalizeCandidate({
        test_name: row.raw_test_name,
        value: row.raw_value,
        unit: row.raw_unit,
        reference_range: row.reference_range_raw,
        status_flag: row.status_flag,
        param_date: row.sample_datetime,
        confidence: confidence ?? 0.9,
        needs_review: confidence !== null && confidence < 0.75,
        raw_source_text: row.raw_source_text,
      });

      // A person confirming a report clears needs_review; recomputing must
      // not raise it again on a confirmed row (it may still be cleared).
      if (row.is_confirmed && !row.needs_review) next.needs_review = false;

      const diffs = DERIVED_COLUMNS.filter((column) => !sameValue(column, row[column], next[column]));
      if (diffs.length === 0) continue;

      stats.changed += 1;
      if (diffs.includes('health_parameter_id')) stats.remapped += 1;
      if (diffs.includes('normalized_unit') || diffs.includes('normalized_value')) stats.unitChanged += 1;
      if (diffs.includes('needs_review')) {
        if (next.needs_review) stats.reviewAdded += 1;
        else stats.reviewCleared += 1;
      }
      changedReports.add(row.report_id);

      if (!dryRun) {
        const sets = diffs.map((column, i) => `${column} = $${i + 2}`);
        await pool.query(`UPDATE health_measurements SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [
          row.id,
          ...diffs.map((column) =>
            column === 'ambiguous_candidate_ids' && next[column] ? JSON.stringify(next[column]) : next[column]
          ),
        ]);
        const evaluationInputsChanged = ['health_parameter_id', 'normalized_value', 'numeric_value', 'qualitative_value'].some((c) =>
          diffs.includes(c)
        );
        if (row.is_confirmed && evaluationInputsChanged) insightWork.push(row.id);
      }
    }
  }

  if (!dryRun) {
    // Insights are materialised from the values they cited, so a confirmed
    // result whose value/mapping changed gets its insights re-derived. Skipped
    // when insight text is AI-generated, to avoid spending on a data repair.
    if (config.insightProvider !== 'claude') {
      for (const id of insightWork) {
        try {
          await supersedeInsightsForMeasurement(id);
          await runForMeasurement(id);
          stats.insightsRefreshed += 1;
        } catch (err) {
          log(`insight refresh failed for one result: ${err.message}`);
        }
      }
    }

    // The stored one-line summary is a snapshot from upload time, so it goes
    // stale whenever results are re-judged - for every plain lab report, not
    // only ones whose rows changed in this run. Idempotent: written only when
    // the text differs.
    const { rows: summaries } = await pool.query(
      `SELECT r.id, r.generated_summary FROM reports r
       WHERE r.generated_summary LIKE 'Extracted %' AND r.generated_summary NOT LIKE '%Imported %'
         AND ($1::uuid IS NULL OR r.user_id = $1)
         AND ($2::uuid IS NULL OR r.id = $2)`,
      [userId, reportId]
    );
    for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
      const batch = summaries.slice(i, i + BATCH_SIZE);
      const countsByReport = await countReports(batch.map((r) => r.id));
      for (const report of batch) {
        const text = liveSummary(report, countsByReport.get(report.id));
        if (text && text !== report.generated_summary) {
          await pool.query('UPDATE reports SET generated_summary = $2, updated_at = now() WHERE id = $1', [report.id, text]);
          stats.summariesRefreshed += 1;
        }
      }
    }

    // Narrative text follows the stored results; refresh it for reports whose
    // results changed in this run.
    if (config.summaryProvider !== 'claude') {
      for (const id of changedReports) {
        try {
          await refreshSummaryForReport(id);
          stats.reportsRefreshed += 1;
        } catch (err) {
          log(`narrative refresh failed for one report: ${err.message}`);
        }
      }
    }
  }

  stats.dryRun = dryRun;
  return stats;
}

module.exports = { renormalize };
