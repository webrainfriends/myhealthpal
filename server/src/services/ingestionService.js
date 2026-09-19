const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const { extractParameters } = require('./parameterExtractor');
const { generateSummary } = require('./summaryService');

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
    const { parameters, warnings } = extractParameters(document);
    const summary = generateSummary(parameters);

    // Never touch already-confirmed measurements on retry.
    await pool.query('DELETE FROM extracted_parameters WHERE report_id = $1 AND is_confirmed = false', [reportId]);

    for (const param of parameters) {
      await pool.query(
        `INSERT INTO extracted_parameters
           (report_id, job_id, test_name, value, numeric_value, unit, reference_range, status_flag, param_date, confidence, needs_review, raw_source_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          reportId,
          jobId,
          param.test_name,
          param.value,
          param.numeric_value,
          param.unit,
          param.reference_range,
          param.status_flag,
          param.param_date,
          param.confidence,
          param.needs_review,
          param.raw_source_text,
        ]
      );
    }

    const extractionStatus = document.contentKind === 'image_scanned' ? 'OCR Pending' : 'Text Extracted';

    await pool.query(
      `UPDATE reports
       SET ingestion_status = 'Needs Review',
           extraction_status = $2,
           generated_summary = $3,
           updated_at = now()
       WHERE id = $1`,
      [reportId, extractionStatus, summary]
    );

    await pool.query(
      `UPDATE ingestion_jobs
       SET status = 'Succeeded', content_kind = $2, diagnostics = $3, finished_at = now()
       WHERE id = $1`,
      [jobId, document.contentKind, JSON.stringify({ warnings, extractedCount: parameters.length })]
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
