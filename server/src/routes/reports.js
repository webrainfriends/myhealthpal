const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { enqueueProcessing } = require('../services/ingestionService');
const registry = require('../extraction/registry');
const { classifyValue } = require('../extraction/normalizationService');

const router = express.Router();

// No real auth system yet; every request acts as the seeded demo user.
function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
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
              detected_report_date, source_provider, report_type, ingestion_status, extraction_status,
              validation_status, processing_error, generated_summary, confirmed_at, created_at, updated_at
       FROM reports WHERE user_id = $1 ORDER BY created_at DESC`,
      [currentUserId(req)]
    );
    res.json({ reports: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const report = rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const measurements = await pool.query(MEASUREMENT_LIST_QUERY, [req.params.id]);
    res.json({ report, measurements: measurements.rows });
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
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      const extension = extensionOf(req.file.originalname);
      const { rows } = await pool.query(
        `INSERT INTO reports
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [currentUserId(req), req.file.originalname, req.file.mimetype, extension, req.file.size, req.file.path]
      );
      const report = rows[0];

      enqueueProcessing(report.id);

      res.status(201).json({ report });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

router.post('/:id/retry', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const report = rows[0];
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

const EDITABLE_FIELDS = ['raw_test_name', 'raw_value', 'raw_unit', 'reference_range_raw', 'status_flag', 'sample_datetime'];

router.patch('/:id/measurements/:measurementId', async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT id FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Report not found' });

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

    res.json({ measurement: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const report = rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.ingestion_status !== 'Needs Review') {
      return res.status(409).json({ error: `Report cannot be confirmed from status "${report.ingestion_status}".` });
    }

    await pool.query('UPDATE health_measurements SET is_confirmed = true, updated_at = now() WHERE report_id = $1', [
      req.params.id,
    ]);
    const updated = await pool.query(
      `UPDATE reports SET ingestion_status = 'Completed', confirmed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    res.json({ report: updated.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
