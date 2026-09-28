const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const { loadFileBuffer } = require('../security/secureUpload');
const { withTimeout } = require('../lib/withTimeout');
const { logError } = require('../lib/safeLog');
const config = require('../config');
const provider = require('../extraction/providers/dietScheduleExtractionProvider');
const scheduleService = require('./scheduleService');
const recipeBackfillService = require('./recipeBackfillService');

// Turns an uploaded diet-schedule document (any format the report pipeline
// already supports - PDF/DOCX/XLSX/CSV/photo) into a real diet_schedules +
// diet_schedule_entries record, then starts recipe backfill on it - the
// diet-schedule analog of dietScanService.js's processDietScan.

function enqueueScheduleImportProcessing(importId) {
  setImmediate(() => {
    processScheduleImport(importId).catch((err) => logError(`Unhandled error processing diet schedule import ${importId}`, err));
  });
}

async function processScheduleImport(importId) {
  const { rows } = await pool.query('SELECT * FROM diet_schedule_imports WHERE id = $1', [importId]);
  const record = rows[0];
  if (!record) return;

  await pool.query(
    `UPDATE diet_schedule_imports SET ingestion_status = 'Processing', processing_error = NULL, updated_at = now() WHERE id = $1`,
    [importId]
  );

  try {
    const adapter = getAdapter(record.file_extension);
    if (!adapter) throw new Error(`No ingestion adapter registered for .${record.file_extension} files`);

    // Decrypted into memory only while processing (never written to disk) -
    // same as every other uploaded medical/health document.
    const fileBuffer = await loadFileBuffer(record, {
      purpose: 'diet_schedule_import',
      resourceType: 'diet_schedule_import',
    });
    const document = await withTimeout(
      adapter.extract(fileBuffer),
      config.security.parserTimeoutMs,
      'Reading the diet schedule document'
    );
    const { entries, warnings, rawModelOutput } = await provider.extract(document, {
      fileBuffer,
      userId: record.user_id,
      mimeType: record.mime_type,
      requestedDurationDays: record.requested_duration_days,
    });

    if (entries.length === 0) {
      await pool.query(
        `UPDATE diet_schedule_imports SET ingestion_status = 'Failed', processing_error = $2, raw_model_output = $3, updated_at = now() WHERE id = $1`,
        [
          importId,
          warnings.join(' ') || 'No schedule entries could be read from this document.',
          rawModelOutput ? JSON.stringify(rawModelOutput) : null,
        ]
      );
      return;
    }

    // The extraction provider is told not to invent days, but a document
    // describing a longer plan than requested (e.g. a 30-day plan uploaded
    // against a 7-day schedule) is trimmed to what the person actually
    // picked rather than silently creating a longer schedule than asked for.
    const withinDuration = entries.filter((e) => e.dayNumber <= record.requested_duration_days);

    const { rows: scheduleRows } = await pool.query(
      `INSERT INTO diet_schedules (user_id, title, duration_days, start_date, source_type, import_id)
       VALUES ($1, $2, $3, $4, 'imported', $5) RETURNING *`,
      [record.user_id, record.original_filename, record.requested_duration_days, record.requested_start_date, importId]
    );
    const schedule = scheduleRows[0];
    await scheduleService.insertEntries(schedule.id, record.requested_start_date, withinDuration);

    // Always "Needs Review" (regardless of individual entry confidence) so
    // the person sees the parsed schedule and can fix any misread day/dish
    // before relying on it - recipe generation starts immediately after
    // anyway (below), and editing a dish name resets/re-enqueues just that
    // entry's recipe (see scheduleService.updateEntry).
    await pool.query(
      `UPDATE diet_schedule_imports SET ingestion_status = 'Needs Review', raw_model_output = $2, updated_at = now() WHERE id = $1`,
      [importId, rawModelOutput ? JSON.stringify(rawModelOutput) : null]
    );

    recipeBackfillService.enqueueBackfill(schedule.id);
  } catch (err) {
    // Reading a document needs the AI provider; without the person's
    // consent the import stops here with an explanation instead of being sent.
    const message =
      err.code === 'ai_consent_required'
        ? 'AI document reading is turned off for this profile. Turn on "AI document processing" in Settings → Privacy & AI, then retry - or create the schedule manually.'
        : err.message;
    await pool.query(
      `UPDATE diet_schedule_imports SET ingestion_status = 'Failed', processing_error = $2, updated_at = now() WHERE id = $1`,
      [importId, message]
    );
  }
}

module.exports = { enqueueScheduleImportProcessing, processScheduleImport };
