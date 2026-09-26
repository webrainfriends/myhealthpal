const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { enqueueProcessing } = require('../services/ingestionService');
const registry = require('../extraction/registry');
const { classifyValue } = require('../extraction/normalizationService');
const { refreshSummaryForReport } = require('../extraction/reportNarrativeService');
const { runForMeasurement, supersedeInsightsForMeasurement } = require('../insights/insightService');
const { signReportDownloadToken } = require('../services/authService');
const { secureStore, encryptionInsertParts, deleteStoredFile } = require('../security/secureUpload');
const { requireConsent } = require('../security/consentService');
const { loadOwnedReport, toPublicRecord } = require('../security/reportAccess');
const audit = require('../security/auditLog');
const { logError } = require('../lib/safeLog');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

const MEASUREMENT_LIST_QUERY = `
  SELECT hm.*, hp.code AS parameter_code, hp.display_name AS parameter_display_name, hp.canonical_unit
  FROM health_measurements hm
  LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
  WHERE hm.report_id = $1
  ORDER BY hm.raw_test_name ASC
`;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, original_filename, mime_type, file_extension, file_size_bytes, upload_timestamp,
              effective_date, date_status, source_type, source_provider, report_type, likely_duplicate_of_report_id,
              ingestion_status, extraction_status, validation_status, processing_error, generated_summary,
              confirmed_at, created_at, updated_at
       FROM reports WHERE user_id = $1 ORDER BY COALESCE(effective_date, created_at::date) DESC, created_at DESC`,
      [currentUserId(req)]
    );
    res.json({ reports: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const report = await loadOwnedReport(currentUserId(req), req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const measurements = await pool.query(MEASUREMENT_LIST_QUERY, [req.params.id]);
    const dates = await pool.query('SELECT * FROM report_dates WHERE report_id = $1 ORDER BY date_type ASC', [
      req.params.id,
    ]);
    const narrative = await pool.query(
      `SELECT rsv.summary_text, rsv.provider, rsv.model, rsv.generated_at
       FROM report_summaries rs
       JOIN report_summary_versions rsv ON rsv.id = rs.current_version_id
       WHERE rs.report_id = $1`,
      [req.params.id]
    );

    res.json({
      report: toPublicRecord(report),
      measurements: measurements.rows,
      dates: dates.rows,
      narrativeSummary: narrative.rows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// Mints a short-lived, single-report-scoped token for viewing/downloading
// the original uploaded file exactly as-is. Kept separate from the file
// bytes themselves (served unauthenticated-by-header at GET /api/files/
// report/:id?token=... - see routes/files.js) because opening a link with
// window.open/Linking.openURL can't attach an Authorization header; this
// endpoint is where that still gets checked, once, right before minting.
router.get('/:id/file-url', async (req, res, next) => {
  try {
    const report = await loadOwnedReport(currentUserId(req), req.params.id, { purpose: 'report_view' });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const token = signReportDownloadToken({ userId: currentUserId(req), reportId: req.params.id });
    res.json({ url: `/api/files/report/${req.params.id}?token=${token}` });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File exceeds the ${Math.round(config.maxUploadBytes / (1024 * 1024))}MB upload limit.`,
        });
      }
      if (err) return next(err);

      if (req.fileValidationError) {
        return res.status(400).json({ error: req.fileValidationError });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file was provided. Attach a file under the "file" field.' });
      }
      if (req.file.size === 0) {
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      // Storing a medical record needs the person's explicit consent
      // (Privacy & AI screen); for a managed family profile, the caregiver
      // gives it on their behalf.
      await requireConsent(currentUserId(req), 'medical_record_storage');
      await audit.record({ eventType: 'REPORT_UPLOAD_STARTED', userId: currentUserId(req), purpose: 'report_upload' });

      // Validated, scanned and encrypted straight from memory - only
      // ciphertext ever reaches disk, under an opaque random name.
      const extension = extensionOf(req.file.originalname);
      const meta = await secureStore({ userId: currentUserId(req), buffer: req.file.buffer, extension });
      req.file.buffer = null;
      const enc = encryptionInsertParts(meta, 6);
      const { rows } = await pool.query(
        `INSERT INTO reports
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, ${enc.placeholders.join(', ')})
         RETURNING *`,
        [currentUserId(req), req.file.originalname, req.file.mimetype, extension, req.file.size, ...enc.values]
      );
      const report = rows[0];
      await audit.record({ eventType: 'REPORT_ENCRYPTED', userId: report.user_id, reportId: report.id, purpose: 'report_upload' });

      enqueueProcessing(report.id);

      res.status(201).json({ report: toPublicRecord(report) });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

router.post('/:id/retry', async (req, res, next) => {
  try {
    const report = await loadOwnedReport(currentUserId(req), req.params.id, { purpose: 'report_retry' });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.ingestion_status === 'Processing') {
      return res.status(409).json({ error: 'Report is already processing.' });
    }

    enqueueProcessing(report.id);
    res.json({ status: 'queued' });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const ownedReport = await loadOwnedReport(currentUserId(req), req.params.id);
    if (!ownedReport) return res.status(404).json({ error: 'Report not found' });

    if (req.body.effective_date === undefined) {
      return res.status(400).json({ error: 'effective_date is required.' });
    }
    const effectiveDate = req.body.effective_date;
    if (Number.isNaN(new Date(effectiveDate).getTime())) {
      return res.status(400).json({ error: 'effective_date must be a valid date.' });
    }

    await pool.query(
      `INSERT INTO report_dates (report_id, date_type, date_value, confidence, source)
       VALUES ($1, 'report_publication', $2, 1.0, 'user_confirmed')`,
      [req.params.id, effectiveDate]
    );
    const { rows } = await pool.query(
      `UPDATE reports SET effective_date = $2, date_status = 'Confirmed', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, effectiveDate]
    );

    res.json({ report: toPublicRecord(rows[0]) });
  } catch (err) {
    next(err);
  }
});

const EDITABLE_FIELDS = ['raw_test_name', 'raw_value', 'raw_unit', 'reference_range_raw', 'status_flag', 'sample_datetime'];

router.patch('/:id/measurements/:measurementId', async (req, res, next) => {
  try {
    const ownedReport = await loadOwnedReport(currentUserId(req), req.params.id);
    if (!ownedReport) return res.status(404).json({ error: 'Report not found' });

    const current = await pool.query('SELECT * FROM health_measurements WHERE id = $1 AND report_id = $2', [
      req.params.measurementId,
      req.params.id,
    ]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Measurement not found' });
    const existing = current.rows[0];

    // health_parameter_id may be explicitly corrected too (including to null,
    // meaning "none of the suggested canonical mappings are right").
    const bodyHasParameterId = Object.prototype.hasOwnProperty.call(req.body, 'health_parameter_id');
    const nextValues = { ...existing };
    const correctionRows = [];

    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      const newValue = req.body[field];
      if (String(existing[field] ?? '') === String(newValue ?? '')) continue;
      correctionRows.push([field, existing[field], newValue]);
      nextValues[field] = newValue;
    }

    let healthParameterId = existing.health_parameter_id;
    if (bodyHasParameterId) {
      const requestedId = req.body.health_parameter_id || null;
      if (requestedId !== existing.health_parameter_id) {
        correctionRows.push(['health_parameter_id', existing.health_parameter_id, requestedId]);
      }
      healthParameterId = requestedId;
    }

    // Re-derive raw_value's parsed shape and, if a canonical parameter is
    // known, its normalized value/unit — never carry over a stale
    // normalization computed against the pre-correction wording.
    const classified = classifyValue(nextValues.raw_value);
    let normalizedUnit = null;
    let normalizedValue = null;
    if (healthParameterId) {
      const parameter = await registry.getParameterById(healthParameterId);
      if (parameter && classified.numericValue !== null && nextValues.raw_unit) {
        const conversion = await registry.convertToCanonicalUnit(parameter, classified.numericValue, nextValues.raw_unit);
        if (conversion) {
          normalizedUnit = conversion.normalizedUnit;
          normalizedValue = conversion.normalizedValue;
        }
      } else if (parameter) {
        normalizedUnit = nextValues.raw_unit || null;
        normalizedValue = classified.numericValue;
      }
    }

    for (const [field, previousValue, newValue] of correctionRows) {
      await pool.query(
        `INSERT INTO measurement_corrections (measurement_id, field_name, previous_value, new_value, corrected_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.measurementId, field, previousValue === null ? null : String(previousValue), newValue === null ? null : String(newValue), currentUserId(req)]
      );
    }

    const { rows } = await pool.query(
      `UPDATE health_measurements SET
         raw_test_name = $2,
         raw_value = $3,
         raw_unit = $4,
         reference_range_raw = $5,
         status_flag = $6,
         sample_datetime = $7,
         health_parameter_id = $8,
         value_type = $9,
         comparator = $10,
         numeric_value = $11,
         qualitative_value = $12,
         normalized_unit = $13,
         normalized_value = $14,
         ambiguous_candidate_ids = CASE WHEN $15 THEN NULL ELSE ambiguous_candidate_ids END,
         needs_review = false,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.measurementId,
        nextValues.raw_test_name,
        nextValues.raw_value,
        nextValues.raw_unit,
        nextValues.reference_range_raw,
        nextValues.status_flag,
        nextValues.sample_datetime,
        healthParameterId,
        classified.valueType,
        classified.comparator,
        classified.numericValue,
        classified.qualitativeValue,
        normalizedUnit,
        normalizedValue,
        bodyHasParameterId,
      ]
    );

    if (correctionRows.length > 0) {
      await refreshSummaryForReport(req.params.id);
    }

    // Corrections to an already-confirmed measurement can invalidate an
    // insight generated from its old value — invalidate first, then
    // re-evaluate against the corrected one.
    if (existing.is_confirmed && correctionRows.length > 0) {
      await supersedeInsightsForMeasurement(req.params.measurementId);
      await runForMeasurement(req.params.measurementId);
    }

    res.json({ measurement: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Lets the user resolve one row this report's own dedup check flagged as a
// likely re-upload of an already-confirmed result ('suspected' - see
// dedupService). 'skip' marks it 'confirmed_duplicate': it stays in the
// report for provenance but is permanently excluded from dashboards/trends
// (see EXCLUDE_DUPLICATES_SQL in routes/dashboard.js), the same as it
// already was while merely 'suspected'. 'keep' marks it 'confirmed_distinct'
// - the user is telling the app this is a genuinely new/different result
// that only coincidentally matched - and from then on it counts like any
// other confirmed measurement. Only ever moves a row off 'suspected'; never
// touches one that's 'none' (dedup found nothing) or already resolved.
router.post('/:id/measurements/:measurementId/duplicate-resolution', async (req, res, next) => {
  try {
    const { action } = req.body;
    if (action !== 'skip' && action !== 'keep') {
      return res.status(400).json({ error: 'action must be "skip" or "keep".' });
    }

    const ownedReport = await loadOwnedReport(currentUserId(req), req.params.id);
    if (!ownedReport) return res.status(404).json({ error: 'Report not found' });

    const nextStatus = action === 'skip' ? 'confirmed_duplicate' : 'confirmed_distinct';
    const { rows } = await pool.query(
      `UPDATE health_measurements SET duplicate_status = $3, updated_at = now()
       WHERE id = $1 AND report_id = $2 AND duplicate_status = 'suspected'
       RETURNING *`,
      [req.params.measurementId, req.params.id, nextStatus]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Measurement not found, or it is not a suspected duplicate.' });
    }

    res.json({ measurement: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', async (req, res, next) => {
  try {
    const report = await loadOwnedReport(currentUserId(req), req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.ingestion_status !== 'Needs Review') {
      return res.status(409).json({ error: `Report cannot be confirmed from status "${report.ingestion_status}".` });
    }

    // Any row still 'suspected' at confirm time means the user never
    // explicitly resolved it (see the duplicate-resolution endpoint above) -
    // default it to skipped ('confirmed_duplicate') rather than silently
    // leaving it 'suspected' forever. Everything else (an explicit 'keep',
    // or a row dedup never flagged at all) is left exactly as-is, so a
    // genuinely new/missing result is still added normally.
    await pool.query(
      `UPDATE health_measurements SET duplicate_status = 'confirmed_duplicate', updated_at = now()
       WHERE report_id = $1 AND duplicate_status = 'suspected'`,
      [req.params.id]
    );

    const confirmedMeasurements = await pool.query(
      `UPDATE health_measurements SET is_confirmed = true, updated_at = now()
       WHERE report_id = $1 RETURNING id, health_parameter_id, duplicate_status`,
      [req.params.id]
    );
    await pool.query(
      `UPDATE reports SET ingestion_status = 'Completed', confirmed_at = now(), updated_at = now() WHERE id = $1`,
      [req.params.id]
    );
    await refreshSummaryForReport(req.params.id);

    for (const measurement of confirmedMeasurements.rows) {
      // A skipped duplicate is never counted as live data (see
      // EXCLUDE_DUPLICATES_SQL) - generating an insight from it would surface
      // a "new"/"changed" observation built on a value that isn't actually
      // being tracked.
      if (measurement.health_parameter_id && measurement.duplicate_status !== 'confirmed_duplicate') {
        await runForMeasurement(measurement.id);
      }
    }

    const updated = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);

    res.json({ report: toPublicRecord(updated.rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Permanently deletes an uploaded report (issue #104 §9): the encrypted
// file, its wrapped data key and metadata (the row itself), and every
// dependent row - health_measurements, ingestion_jobs, extraction_runs,
// measurement_sources, report_dates, report_summaries - via FK ON DELETE
// CASCADE. Once the row (and so the wrapped key) is gone, any copy of the
// ciphertext left in a backup can no longer be decrypted. A non-PHI audit
// event records the deletion.
router.delete('/:id', async (req, res, next) => {
  try {
    const report = await loadOwnedReport(currentUserId(req), req.params.id, { purpose: 'report_delete' });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    await pool.query('DELETE FROM reports WHERE id = $1 AND user_id = $2', [report.id, currentUserId(req)]);
    try {
      await deleteStoredFile(report);
    } catch (err) {
      // The key is already gone with the row, so the ciphertext is
      // unreadable; a leftover object is disk space, not exposure.
      logError(`Could not remove stored file for deleted report ${report.id}`, err);
    }
    await audit.record({ eventType: 'REPORT_DELETED', userId: report.user_id, reportId: report.id, purpose: 'user_request' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
