const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const { loadFileBuffer } = require('../security/secureUpload');
const { withTimeout } = require('../lib/withTimeout');
const { logError } = require('../lib/safeLog');
const config = require('../config');
const provider = require('../extraction/providers/medicationExtractionProvider');

// In-process async runner, same pattern as services/ingestionService.js's
// enqueueProcessing - swappable for a real queue later without touching
// route/DB code.
function enqueueMedicationScanProcessing(scanId) {
  setImmediate(() => {
    processMedicationScan(scanId).catch((err) => {
      logError(`Unhandled error processing medication scan ${scanId}`, err);
    });
  });
}

function computeEndDate(startDate, durationDays) {
  if (!startDate || !durationDays) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + Number(durationDays) * 24 * 60 * 60 * 1000);
  return end.toISOString().slice(0, 10);
}

async function processMedicationScan(scanId) {
  const { rows } = await pool.query('SELECT * FROM medication_scans WHERE id = $1', [scanId]);
  const scan = rows[0];
  if (!scan) return;

  await pool.query(
    `UPDATE medication_scans SET ingestion_status = 'Processing', processing_error = NULL, updated_at = now() WHERE id = $1`,
    [scanId]
  );

  const adapter = getAdapter(scan.file_extension);

  try {
    if (!adapter) {
      throw new Error(`No ingestion adapter registered for .${scan.file_extension} files`);
    }

    // Decrypted into memory only while processing (never written to disk).
    const fileBuffer = await loadFileBuffer(scan, { purpose: 'medication_scan', resourceType: 'medication_scan' });
    const document = await withTimeout(adapter.extract(fileBuffer), config.security.parserTimeoutMs, 'Reading the scan');
    const { medications, documentInfo, rawModelOutput } = await provider.extract(document, {
      fileBuffer,
      userId: scan.user_id,
      mimeType: scan.mime_type,
      scanType: scan.scan_type,
    });

    const insertedIds = [];
    for (const med of medications) {
      const { rows: inserted } = await pool.query(
        `INSERT INTO medications (
           user_id, scan_id, name, generic_name, dosage_amount, dosage_unit, form,
           frequency_per_day, times_of_day, route, instructions, prescribed_for,
           prescribing_doctor, prescribing_clinic, prescription_date, start_date, duration_days, end_date,
           quantity_dispensed, quantity_unit, expiry_date, ingredients_raw,
           source_type, status, extraction_confidence, needs_review, is_confirmed, interval_hours, food_relation
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'active',$23,$24,false,$25,$26)
         RETURNING id`,
        [
          scan.user_id,
          scanId,
          med.name,
          med.generic_name,
          med.dosage_amount,
          med.dosage_unit,
          med.form,
          med.frequency_per_day,
          med.times_of_day.length > 0 ? med.times_of_day : null,
          med.route,
          med.instructions,
          med.prescribed_for,
          documentInfo?.prescribingDoctor || null,
          documentInfo?.pharmacyOrClinic || null,
          documentInfo?.prescriptionDate || null,
          med.start_date,
          med.duration_days,
          computeEndDate(med.start_date, med.duration_days),
          med.quantity_dispensed,
          med.quantity_unit,
          med.expiry_date,
          med.ingredients_raw,
          scan.scan_type === 'tablet_photo' ? 'tablet_photo' : 'prescription_scan',
          med.confidence,
          med.needs_review,
          med.interval_hours,
          med.food_relation,
        ]
      );
      const medicationId = inserted[0].id;
      insertedIds.push(medicationId);

      // Attach the scan's own photo as this medicine's first photo - see
      // migration 029's comment on why this carries no encryption columns
      // of its own and is instead served by decrypting the scan.
      await pool.query(
        `INSERT INTO medication_photos
           (medication_id, user_id, scan_id, source, original_filename, mime_type, file_extension, file_size_bytes)
         VALUES ($1, $2, $3, 'scan', $4, $5, $6, $7)`,
        [medicationId, scan.user_id, scanId, scan.original_filename, scan.mime_type, scan.file_extension, scan.file_size_bytes]
      );
    }

    await pool.query(
      `UPDATE medication_scans SET ingestion_status = $2, raw_model_output = $3, updated_at = now() WHERE id = $1`,
      [scanId, medications.length > 0 ? 'Needs Review' : 'Completed', rawModelOutput ? JSON.stringify(rawModelOutput) : null]
    );
  } catch (err) {
    // Reading a photo needs the AI provider; without the person's consent
    // the scan stops here with an explanation instead of being sent.
    const message =
      err.code === 'ai_consent_required'
        ? 'AI photo reading is turned off for this profile. Turn on "AI document processing" in Settings → Privacy & AI, then retry - or enter the details manually.'
        : err.message;
    await pool.query(
      `UPDATE medication_scans SET ingestion_status = 'Failed', processing_error = $2, updated_at = now() WHERE id = $1`,
      [scanId, message]
    );
  }
}

module.exports = { enqueueMedicationScanProcessing, processMedicationScan, computeEndDate };
