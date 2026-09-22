const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const { generateSummary } = require('./summaryService');
const { runExtraction } = require('../extraction/extractionService');
const { detectAndPersistReportDates } = require('../extraction/reportDateService');
const { reconcileMeasurementDuplicatesForReport } = require('../extraction/dedupService');
const { reconcileReportDuplicate } = require('../extraction/reportDedupService');
const { refreshSummaryForReport } = require('../extraction/reportNarrativeService');
const { importActivityTablesFrom } = require('./activityImportService');

// In-process async runner: kicks off processing without blocking the upload
// response. Swappable for a real queue (BullMQ/SQS/etc.) behind the same
// enqueueProcessing() call site without changing route or DB code.
function enqueueProcessing(reportId) {
  setImmediate(() => {
    processReport(reportId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Unhandled error processing report ${reportId}:`, err);
    });
  });
}

// Retrying a report must never touch already-confirmed measurements (so a
// retry can't duplicate a confirmed result); this clears everything else
// from a previous attempt, plus its now-orphaned provenance rows.
async function clearUnconfirmedMeasurements(reportId) {
  const { rows } = await pool.query(
    `SELECT source_id FROM health_measurements WHERE report_id = $1 AND is_confirmed = false AND source_id IS NOT NULL`,
    [reportId]
  );
  await pool.query('DELETE FROM health_measurements WHERE report_id = $1 AND is_confirmed = false', [reportId]);
  if (rows.length > 0) {
    await pool.query('DELETE FROM measurement_sources WHERE id = ANY($1)', [rows.map((r) => r.source_id)]);
  }
}

async function processReport(reportId) {
  const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1', [reportId]);
  const report = rows[0];
  if (!report) return;

  const previousAttempts = await pool.query(
    'SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM ingestion_jobs WHERE report_id = $1',
    [reportId]
  );
  const attempt = Number(previousAttempts.rows[0].max_attempt) + 1;

  const jobResult = await pool.query(
    `INSERT INTO ingestion_jobs (report_id, status, attempt, started_at)
     VALUES ($1, 'Running', $2, now()) RETURNING id`,
    [reportId, attempt]
  );
  const jobId = jobResult.rows[0].id;

  await pool.query(
    `UPDATE reports SET ingestion_status = 'Processing', processing_error = NULL, updated_at = now() WHERE id = $1`,
    [reportId]
  );

  const adapter = getAdapter(report.file_extension);

  try {
    if (!adapter) {
      throw new Error(`No ingestion adapter registered for .${report.file_extension} files`);
    }

    const document = await adapter.extract(report.storage_path);

    // A wearable/health-tracker "Activity" sheet (steps/calories/distance)
    // isn't a lab result and must never reach the extraction providers
    // below - both would otherwise treat every numeric column as an
    // unmapped clinical result needing review. Pulled out here, before
    // extraction ever sees it, straight into activity_logs.
    let activityImportedDays = 0;
    if (document.contentKind === 'structured_table' && Array.isArray(document.tables)) {
      const { remainingTables, importedDays } = await importActivityTablesFrom(document.tables, report.user_id);
      document.tables = remainingTables;
      activityImportedDays = importedDays;
    }

    await clearUnconfirmedMeasurements(reportId);
    // Nothing left to run through extraction if the whole upload was an
    // activity export - skip the (provider) call entirely rather than
    // asking heuristic/Claude to extract parameters from zero tables.
    const skipExtraction =
      document.contentKind === 'structured_table' && document.tables.length === 0 && activityImportedDays > 0;
    const { measurements, warnings, document: docInfo, ocrAttempted } = skipExtraction
      ? { measurements: [], warnings: [], document: null, ocrAttempted: false }
      : await runExtraction({
          reportId,
          userId: report.user_id,
          document,
          filePath: report.storage_path,
          mimeType: report.mime_type,
        });
    const activityNote =
      activityImportedDays > 0
        ? `Imported ${activityImportedDays} day${activityImportedDays === 1 ? '' : 's'} of activity data (steps, and calories/distance where present) - see the Activity screen.`
        : null;
    const summary = [activityNote, generateSummary(measurements)].filter(Boolean).join(' ');

    const { effectiveDate } = await detectAndPersistReportDates({
      reportId,
      document,
      measurements,
      uploadTimestamp: report.upload_timestamp,
      aiReportDate: docInfo?.reportDate,
    });
    // Catches the common case dedup couldn't judge during extraction (no
    // per-measurement date was on the line/row itself) now that this
    // report's own effective_date is known - must run before the
    // report-level majority check below so it sees the full picture.
    await reconcileMeasurementDuplicatesForReport({ userId: report.user_id, reportId, effectiveDate });
    await reconcileReportDuplicate(reportId);

    // A vision-capable provider (Claude) actually read a scanned document's
    // page images; a non-vision provider (heuristic) never can, so it stays
    // 'OCR Pending' regardless of whether pdfAdapter rendered page images.
    const extractionStatus =
      document.contentKind === 'image_scanned' ? (ocrAttempted ? 'OCR Extracted' : 'OCR Pending') : 'Text Extracted';

    await pool.query(
      `UPDATE reports
       SET ingestion_status = 'Needs Review',
           extraction_status = $2,
           generated_summary = $3,
           source_provider = COALESCE($4, source_provider),
           report_type = COALESCE($5, report_type),
           notes = COALESCE($6, notes),
           alerts = COALESCE($7, alerts),
           updated_at = now()
       WHERE id = $1`,
      [
        reportId,
        extractionStatus,
        summary,
        docInfo?.labName || null,
        docInfo?.reportType || null,
        docInfo?.notes?.length ? docInfo.notes.join('\n') : null,
        docInfo?.alerts?.length ? docInfo.alerts.join('\n') : null,
      ]
    );

    await refreshSummaryForReport(reportId);

    await pool.query(
      `UPDATE ingestion_jobs
       SET status = 'Succeeded', content_kind = $2, diagnostics = $3, finished_at = now()
       WHERE id = $1`,
      [jobId, document.contentKind, JSON.stringify({ warnings, extractedCount: measurements.length })]
    );
  } catch (err) {
    await pool.query(
      `UPDATE reports SET ingestion_status = 'Failed', extraction_status = 'Failed', processing_error = $2, updated_at = now() WHERE id = $1`,
      [reportId, err.message]
    );
    await pool.query(
      `UPDATE ingestion_jobs SET status = 'Failed', error_message = $2, finished_at = now() WHERE id = $1`,
      [jobId, err.message]
    );
  }
}

module.exports = { enqueueProcessing, processReport };
