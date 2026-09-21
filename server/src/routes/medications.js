const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { enqueueMedicationScanProcessing, computeEndDate } = require('../medications/medicationScanService');
const { syncParameterLinks, findKnowledgeEntry } = require('../medications/medicationLinkingService');
const { recomputeAlertsForMedication, recomputeAlertsForUser } = require('../medications/medicationAlertService');
const { buildMedicationForecast } = require('../medications/medicationForecastService');

const router = express.Router();

// Medication scans are always a photo or a single-page scan (prescription
// or tablet/packaging) - a narrower set than the general report upload's
// SUPPORTED_EXTENSIONS.
const SCAN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'pdf']);

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

function knowledgeSummary(medication) {
  const entry = findKnowledgeEntry(medication);
  if (!entry) return null;
  return { category: entry.category, usage: entry.usage, typicalDailyDose: entry.typicalDailyDose };
}

router.get('/', async (req, res, next) => {
  try {
    await recomputeAlertsForUser(currentUserId(req));

    const { rows } = await pool.query(
      `SELECT * FROM medications WHERE user_id = $1 ORDER BY is_confirmed ASC, created_at DESC`,
      [currentUserId(req)]
    );
    const medications = rows.map((med) => ({ ...med, knowledge: knowledgeSummary(med) }));
    res.json({ medications });
  } catch (err) {
    next(err);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    await recomputeAlertsForUser(currentUserId(req));

    const state = req.query.state || 'active';
    const { rows } = await pool.query(
      `SELECT ma.*, m.name AS medication_name
       FROM medication_alerts ma
       JOIN medications m ON m.id = ma.medication_id
       WHERE ma.user_id = $1 AND ($2 = 'all' OR ma.lifecycle_state = $2)
       ORDER BY ma.severity = 'important' DESC, ma.severity = 'attention' DESC, ma.due_date ASC NULLS LAST, ma.generated_at DESC`,
      [currentUserId(req), state]
    );
    res.json({ alerts: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/alerts/:id/dismiss', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE medication_alerts SET lifecycle_state = 'dismissed', updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, currentUserId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/scans', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File exceeds the ${Math.round(config.maxUploadBytes / (1024 * 1024))}MB upload limit.`,
        });
      }
      if (err) return next(err);
      if (!req.file) {
        return res.status(400).json({ error: 'No file was provided. Attach a file under the "file" field.' });
      }

      const extension = extensionOf(req.file.originalname);
      if (!SCAN_EXTENSIONS.has(extension)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Unsupported file type. Use a JPG/PNG photo or a PDF scan.' });
      }
      if (req.file.size === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      const scanType = req.body.scan_type === 'tablet_photo' ? 'tablet_photo' : 'prescription';
      const { rows } = await pool.query(
        `INSERT INTO medication_scans
           (user_id, scan_type, original_filename, mime_type, file_extension, file_size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [currentUserId(req), scanType, req.file.originalname, req.file.mimetype, extension, req.file.size, req.file.path]
      );
      const scan = rows[0];

      enqueueMedicationScanProcessing(scan.id);

      res.status(201).json({ scan });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

router.get('/scans/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM medication_scans WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const scan = rows[0];
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    const medications = await pool.query('SELECT * FROM medications WHERE scan_id = $1 ORDER BY created_at ASC', [
      req.params.id,
    ]);
    res.json({ scan, medications: medications.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/scans/:id/retry', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM medication_scans WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const scan = rows[0];
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    if (scan.ingestion_status === 'Processing') {
      return res.status(409).json({ error: 'Scan is already processing.' });
    }

    await pool.query('DELETE FROM medications WHERE scan_id = $1 AND is_confirmed = false', [req.params.id]);
    enqueueMedicationScanProcessing(scan.id);
    res.json({ status: 'queued' });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }

    const endDate = computeEndDate(body.start_date, body.duration_days);
    const { rows } = await pool.query(
      `INSERT INTO medications (
         user_id, name, generic_name, brand_name, form, dosage_amount, dosage_unit,
         frequency_per_day, times_of_day, route, instructions, prescribed_for, prescribing_doctor,
         start_date, duration_days, end_date, quantity_dispensed, quantity_unit, expiry_date,
         source_type, status, notes, is_confirmed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'manual',$20,$21,true)
       RETURNING *`,
      [
        currentUserId(req),
        body.name,
        body.generic_name || null,
        body.brand_name || null,
        body.form || null,
        body.dosage_amount ?? null,
        body.dosage_unit || null,
        body.frequency_per_day ?? null,
        Array.isArray(body.times_of_day) && body.times_of_day.length > 0 ? body.times_of_day : null,
        body.route || null,
        body.instructions || null,
        body.prescribed_for || null,
        body.prescribing_doctor || null,
        body.start_date || null,
        body.duration_days ?? null,
        endDate,
        body.quantity_dispensed ?? null,
        body.quantity_unit || null,
        body.expiry_date || null,
        body.status || 'active',
        body.notes || null,
      ]
    );
    const medication = rows[0];

    await syncParameterLinks(medication.id);
    await recomputeAlertsForMedication(medication);

    res.status(201).json({ medication });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM medications WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const medication = rows[0];
    if (!medication) return res.status(404).json({ error: 'Medication not found' });

    const entry = findKnowledgeEntry(medication);
    const forecast = await buildMedicationForecast(medication, entry);

    res.json({
      medication,
      knowledge: entry ? { category: entry.category, usage: entry.usage, typicalDailyDose: entry.typicalDailyDose } : null,
      forecast,
    });
  } catch (err) {
    next(err);
  }
});

const EDITABLE_FIELDS = [
  'name',
  'generic_name',
  'brand_name',
  'form',
  'dosage_amount',
  'dosage_unit',
  'frequency_per_day',
  'times_of_day',
  'route',
  'instructions',
  'prescribed_for',
  'prescribing_doctor',
  'start_date',
  'duration_days',
  'quantity_dispensed',
  'quantity_unit',
  'expiry_date',
  'status',
  'notes',
];
const IDENTITY_FIELDS = new Set(['name', 'generic_name', 'brand_name']);

router.patch('/:id', async (req, res, next) => {
  try {
    const current = await pool.query('SELECT * FROM medications WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const existing = current.rows[0];
    if (!existing) return res.status(404).json({ error: 'Medication not found' });

    const next_ = { ...existing };
    let identityChanged = false;
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      next_[field] = req.body[field];
      if (IDENTITY_FIELDS.has(field)) identityChanged = true;
    }
    next_.end_date = computeEndDate(next_.start_date, next_.duration_days);

    const { rows } = await pool.query(
      `UPDATE medications SET
         name = $2, generic_name = $3, brand_name = $4, form = $5, dosage_amount = $6, dosage_unit = $7,
         frequency_per_day = $8, times_of_day = $9, route = $10, instructions = $11, prescribed_for = $12,
         prescribing_doctor = $13, start_date = $14, duration_days = $15, end_date = $16,
         quantity_dispensed = $17, quantity_unit = $18, expiry_date = $19, status = $20, notes = $21,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        next_.name,
        next_.generic_name,
        next_.brand_name,
        next_.form,
        next_.dosage_amount,
        next_.dosage_unit,
        next_.frequency_per_day,
        Array.isArray(next_.times_of_day) && next_.times_of_day.length > 0 ? next_.times_of_day : null,
        next_.route,
        next_.instructions,
        next_.prescribed_for,
        next_.prescribing_doctor,
        next_.start_date,
        next_.duration_days,
        next_.end_date,
        next_.quantity_dispensed,
        next_.quantity_unit,
        next_.expiry_date,
        next_.status,
        next_.notes,
      ]
    );
    const medication = rows[0];

    if (medication.is_confirmed && identityChanged) {
      await syncParameterLinks(medication.id);
    }
    if (medication.is_confirmed) {
      await recomputeAlertsForMedication(medication);
      if (existing.status === 'active' && medication.status !== 'active') {
        await pool.query(
          `UPDATE medication_alerts SET lifecycle_state = 'resolved', updated_at = now()
           WHERE medication_id = $1 AND lifecycle_state = 'active'`,
          [medication.id]
        );
      }
    }

    res.json({ medication });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE medications SET is_confirmed = true, needs_review = false, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, currentUserId(req)]
    );
    const medication = rows[0];
    if (!medication) return res.status(404).json({ error: 'Medication not found' });

    await syncParameterLinks(medication.id);
    await recomputeAlertsForMedication(medication);

    res.json({ medication });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM medications WHERE id = $1 AND user_id = $2 RETURNING id', [
      req.params.id,
      currentUserId(req),
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Medication not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
