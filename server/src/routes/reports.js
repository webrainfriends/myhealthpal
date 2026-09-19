const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { enqueueProcessing } = require('../services/ingestionService');

const router = express.Router();

// No real auth system yet; every request acts as the seeded demo user.
function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
}

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

    const params = await pool.query(
      'SELECT * FROM extracted_parameters WHERE report_id = $1 ORDER BY test_name ASC',
      [req.params.id]
    );
    res.json({ report, parameters: params.rows });
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

router.patch('/:id/parameters/:paramId', async (req, res, next) => {
  try {
    const owned = await pool.query('SELECT id FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Report not found' });

    const { test_name: testName, value, unit, reference_range: referenceRange, status_flag: statusFlag, param_date: paramDate } =
      req.body;

    const numericValue = value !== undefined ? Number.parseFloat(String(value).replace(/[<>]/g, '')) : undefined;

    const { rows } = await pool.query(
      `UPDATE extracted_parameters SET
         test_name = COALESCE($3, test_name),
         value = COALESCE($4, value),
         numeric_value = CASE WHEN $4::text IS NOT NULL THEN $5 ELSE numeric_value END,
         unit = COALESCE($6, unit),
         reference_range = COALESCE($7, reference_range),
         status_flag = COALESCE($8, status_flag),
         param_date = COALESCE($9, param_date),
         needs_review = false,
         updated_at = now()
       WHERE id = $2 AND report_id = $1
       RETURNING *`,
      [
        req.params.id,
        req.params.paramId,
        testName ?? null,
        value ?? null,
        Number.isFinite(numericValue) ? numericValue : null,
        unit ?? null,
        referenceRange ?? null,
        statusFlag ?? null,
        paramDate ?? null,
      ]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Parameter not found' });
    res.json({ parameter: rows[0] });
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

    await pool.query('UPDATE extracted_parameters SET is_confirmed = true, updated_at = now() WHERE report_id = $1', [
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
