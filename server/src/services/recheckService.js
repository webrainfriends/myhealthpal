const pool = require('../db/pool');
const config = require('../config');
const { loadOwnedReport } = require('../security/reportAccess');
const { ServiceError } = require('../lib/serviceError');
const { reportDisplayTitle } = require('../lib/reportTitle');
const { renormalize } = require('./renormalizeService');
const { countReports, liveSummary } = require('./attentionService');
const { reconcileMeasurementDuplicatesForReport } = require('../extraction/dedupService');
const { reconcileReportDuplicate } = require('../extraction/reportDedupService');
const { refreshSummaryForReport } = require('../extraction/reportNarrativeService');

// "Re-check results" for one report: re-applies the current matching, unit and
// flag rules to the values already extracted from it, then refreshes its
// summary, insights and duplicate flags. Unlike re-processing the file it
// never re-reads the document, calls no AI, never changes the report's status
// (so it stays on the dashboard throughout), and leaves results a person
// corrected and everything they confirmed exactly as they were.

// One re-check per report at a time (two quick taps must not overlap).
const inFlight = new Set();

async function recheckReport(userId, reportId) {
  // Required lazily: dashboard.js pulls in most of the app.
  const { fetchNeedsAttentionDetailed } = require('../routes/dashboard');

  const report = await loadOwnedReport(userId, reportId, { purpose: 'report_recheck' });
  if (!report) throw new ServiceError(404, 'Report not found');
  if (['Processing', 'Uploaded'].includes(report.ingestion_status)) {
    throw new ServiceError(409, 'This report is still being processed. Try again in a moment.');
  }
  const { rows: existing } = await pool.query('SELECT count(*)::int AS n FROM health_measurements WHERE report_id = $1', [report.id]);
  if (existing[0].n === 0) {
    throw new ServiceError(409, 'This report has no extracted results to re-check. Use Re-process file instead.');
  }
  if (inFlight.has(report.id)) throw new ServiceError(409, 'A re-check of this report is already running.');

  inFlight.add(report.id);
  try {
    const stats = await renormalize({ dryRun: false, userId, reportId: report.id });

    // Re-normalizing can change a value's unit, which is what duplicate
    // matching compares - same follow-up the upload pipeline runs.
    await reconcileMeasurementDuplicatesForReport({ userId, reportId: report.id, effectiveDate: report.effective_date });
    await reconcileReportDuplicate(report.id);
    if (config.summaryProvider !== 'claude') await refreshSummaryForReport(report.id);

    const counts = (await countReports([report.id])).get(report.id);
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [report.id]);
    const fresh = rows[0];
    const dashboard = (await fetchNeedsAttentionDetailed(userId)).counts;

    return {
      report: {
        id: fresh.id,
        displayTitle: reportDisplayTitle(fresh),
        status: fresh.ingestion_status,
        summary: liveSummary(fresh, counts),
      },
      stats: {
        scanned: stats.scanned,
        updated: stats.changed,
        remapped: stats.remapped,
        unitsFixed: stats.unitChanged,
        reviewCleared: stats.reviewCleared,
        reviewAdded: stats.reviewAdded,
        skippedEdited: stats.skippedEdited,
      },
      // This report's results, judged exactly as the needs-attention list is.
      counts: { outOfRange: counts.abnormal, derivedOutOfRange: counts.derivedAbnormal, needReview: counts.review },
      // The whole dashboard's current needs-attention totals, to compare.
      dashboard: {
        outOfRange: dashboard.abnormal,
        derivedOutOfRange: dashboard.derivedAbnormal,
        needReview: dashboard.review,
        lowConfidence: dashboard.lowConfidence,
        hiddenAsReplaced: dashboard.supersededHidden,
        hiddenAsOld: dashboard.staleHidden,
      },
    };
  } finally {
    inFlight.delete(report.id);
  }
}

module.exports = { recheckReport };
