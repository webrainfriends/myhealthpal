const pool = require('../db/pool');
const { normalizeHeader } = require('./parameterExtractor');
const { ACTIVITY_ONLY_RAW_NAMES } = require('./activityImportService');

// A report uploaded before activityImportService.js existed had its wearable
// "Activity" sheet (Steps/Distance/Calories Burned/Duration/...) run through
// the generic clinical extractor and left sitting in health_measurements as
// unmapped, "needs review" results - cluttering Needs Attention, and never
// reaching activity_logs at all, so the Activity screen's rings stayed
// empty. Fixing the pipeline going forward doesn't touch data that pipeline
// already wrote, and the only in-app path to redo it (Report Detail's
// "Re-process this file") is easy to miss on a report that isn't marked
// Failed. This runs once at server startup, finds every such report by the
// telltale fitness-only column names sitting in its health_measurements,
// and reprocesses each one under the fixed pipeline - so the fix is
// retroactive without anyone having to find a button.
async function findMisclassifiedActivityReportIds() {
  const { rows } = await pool.query(
    `SELECT DISTINCT report_id, raw_test_name
     FROM health_measurements
     WHERE health_parameter_id IS NULL AND is_confirmed = false`
  );
  const reportIds = new Set();
  for (const row of rows) {
    if (ACTIVITY_ONLY_RAW_NAMES.has(normalizeHeader(row.raw_test_name))) {
      reportIds.add(row.report_id);
    }
  }
  return [...reportIds];
}

// Runs sequentially (not in parallel) - this only ever affects a handful of
// legacy reports per server lifetime, and processReport already does several
// queries per report, so there's nothing to gain from racing them against
// each other and a real cost (connection pool pressure, interleaved log
// output) to doing so.
async function backfillMisclassifiedActivityReports() {
  const { processReport } = require('./ingestionService'); // lazy: avoids a require cycle with ingestionService.js
  const reportIds = await findMisclassifiedActivityReportIds();
  for (const reportId of reportIds) {
    try {
      await processReport(reportId);
      // eslint-disable-next-line no-console
      console.log(`Backfilled misclassified activity report ${reportId}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to backfill activity report ${reportId}:`, err);
    }
  }
  return reportIds.length;
}

module.exports = { findMisclassifiedActivityReportIds, backfillMisclassifiedActivityReports };
