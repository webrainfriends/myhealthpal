const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { secureStore, encryptionInsertParts, deleteStoredFile } = require('../security/secureUpload');
const { requireConsent } = require('../security/consentService');
const { toPublicRecord } = require('../security/reportAccess');
const { signMedicationPhotoDownloadToken } = require('../services/authService');
const audit = require('../security/auditLog');
const { enqueueMedicationScanProcessing, computeEndDate } = require('../medications/medicationScanService');
const { syncParameterLinks, findKnowledgeEntry } = require('../medications/medicationLinkingService');
const { getMedicationKnowledge } = require('../medications/medicationKnowledgeService');
const { recomputeAlertsForMedication, recomputeAlertsForUser, dismissAlert } = require('../medications/medicationAlertService');
const { buildMedicationForecast } = require('../medications/medicationForecastService');
const reminderService = require('../medications/medicationReminderService');
const reminderRules = require('../medications/medicationReminderRules');
const { ServiceError } = require('../lib/serviceError');
const recordRemoval = require('../services/recordRemovalService');

const router = express.Router();

// Medication scans are always a photo or a single-page scan (prescription
// or tablet/packaging) - a narrower set than the general report upload's
// SUPPORTED_EXTENSIONS.
const SCAN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'pdf']);

// A directly-attached medication photo is always a plain photo, never a
// PDF scan.
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const PHOTO_SOURCES = new Set(['camera', 'library', 'file']);
const MAX_PHOTOS_PER_MEDICATION = 2;

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

async function loadOwnedMedication(userId, medicationId) {
  const { rows } = await pool.query('SELECT * FROM medications WHERE id = $1 AND user_id = $2', [medicationId, userId]);
  return rows[0] || null;
}

// Dose-timing fields: times_of_day is any mix of morning/afternoon/evening/
// night and HH:MM clock times; interval_hours is "every X hours" (1-24);
// food_relation is before/after/with food or empty stomach.
function validateTiming(source) {
  const times = Array.isArray(source.times_of_day) ? source.times_of_day.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (times.some((t) => !reminderRules.NAMED_TIMES.includes(t) && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) {
    return { error: 'times_of_day must be morning, afternoon, evening, night or an HH:MM time.' };
  }
  let interval = source.interval_hours === '' || source.interval_hours === undefined ? null : source.interval_hours;
  if (interval !== null) {
    interval = Number(interval);
    if (!(interval >= 1 && interval <= 24)) return { error: 'interval_hours must be between 1 and 24.' };
  }
  const food = source.food_relation || null;
  if (food !== null && !reminderRules.FOOD_RELATIONS.includes(food)) {
    return { error: 'food_relation must be before_food, after_food, with_food or empty_stomach.' };
  }
  return { times_of_day: times.length > 0 ? [...new Set(times)] : null, interval_hours: interval, food_relation: food };
}

router.get('/', async (req, res, next) => {
  try {
    await recomputeAlertsForUser(currentUserId(req));

    const { rows } = await pool.query(
      `SELECT * FROM medications WHERE user_id = $1 ORDER BY is_confirmed ASC, created_at DESC`,
      [currentUserId(req)]
    );
    // A medication outside the curated knowledge base falls through to an
    // AI-generated lookup (see medicationKnowledgeService.js) - "details
    // irrespective of whether it's in the tracking list", same as this
    // list already shows results for a measurement the app never learned
    // to canonically track.
    const medications = await Promise.all(
      rows.map(async (med) => ({ ...med, knowledge: await getMedicationKnowledge(med, req.user.preferred_language) }))
    );
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
    res.json({ alert: await dismissAlert(currentUserId(req), req.params.id) });
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Dose reminders. They run off each medication's own quantity, number of
// doses, schedule and expiry - never a lab report. A caretaker with manage
// access reaches these as the member's profile (X-Profile-Id); a sponsor
// sees the same figures on the beneficiary dashboard.
router.get('/reminders/today', async (req, res, next) => {
  try {
    const date = reminderService.resolveDate(req.query.date);
    const reminders = await reminderService.remindersForUser(currentUserId(req), date);
    res.json({
      date,
      reminders,
      totals: {
        due: reminders.reduce((n, r) => n + r.dueCount, 0),
        taken: reminders.reduce((n, r) => n + r.takenCount, 0),
        missedRecent: reminders.reduce((n, r) => n + r.missedRecent, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/doses', async (req, res, next) => {
  try {
    const reminder = await reminderService.recordDose(
      currentUserId(req),
      req.params.id,
      req.body || {},
      req.accountUser ? req.accountUser.id : req.user.id
    );
    res.json({ reminder });
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
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
        return res.status(400).json({ error: 'Unsupported file type. Use a JPG/PNG photo or a PDF scan.' });
      }
      if (req.file.size === 0) {
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      const scanType = req.body.scan_type === 'tablet_photo' ? 'tablet_photo' : 'prescription';
      await requireConsent(currentUserId(req), 'medical_record_storage');
      const meta = await secureStore({ userId: currentUserId(req), buffer: req.file.buffer, extension });
      req.file.buffer = null;
      const enc = encryptionInsertParts(meta, 7);
      const { rows } = await pool.query(
        `INSERT INTO medication_scans
           (user_id, scan_type, original_filename, mime_type, file_extension, file_size_bytes, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, $6, ${enc.placeholders.join(', ')})
         RETURNING *`,
        [currentUserId(req), scanType, req.file.originalname, req.file.mimetype, extension, req.file.size, ...enc.values]
      );
      const scan = rows[0];

      enqueueMedicationScanProcessing(scan.id);

      res.status(201).json({ scan: toPublicRecord(scan) });
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
    res.json({ scan: toPublicRecord(scan), medications: medications.rows });
  } catch (err) {
    next(err);
  }
});

// Permanently deletes a scan's photo/document (encrypted object and its
// wrapped key) plus any not-yet-confirmed items read from it. Confirmed
// items the person already kept stay (their scan link is cleared by
// ON DELETE SET NULL).
router.delete('/scans/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM medication_scans WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const scan = rows[0];
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    await pool.query('DELETE FROM medications WHERE scan_id = $1 AND is_confirmed = false', [scan.id]);
    await pool.query('DELETE FROM medication_scans WHERE id = $1', [scan.id]);
    await deleteStoredFile(scan).catch(() => {});
    await audit.record({ eventType: 'REPORT_DELETED', userId: scan.user_id, resourceType: 'medication_scan', purpose: 'user_request' });
    res.status(204).send();
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

    const timing = validateTiming(body);
    if (timing.error) return res.status(400).json({ error: timing.error });

    const endDate = computeEndDate(body.start_date, body.duration_days);
    const { rows } = await pool.query(
      `INSERT INTO medications (
         user_id, name, generic_name, brand_name, form, dosage_amount, dosage_unit,
         frequency_per_day, times_of_day, route, instructions, prescribed_for, prescribing_doctor,
         prescribing_clinic, prescription_date,
         start_date, duration_days, end_date, quantity_dispensed, quantity_unit, expiry_date, ingredients_raw,
         medicine_system, source_type, status, notes, is_confirmed, total_doses, reminders_enabled, interval_hours, food_relation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'manual',$24,$25,true,$26,$27,$28,$29)
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
        timing.times_of_day,
        body.route || null,
        body.instructions || null,
        body.prescribed_for || null,
        body.prescribing_doctor || null,
        body.prescribing_clinic || null,
        body.prescription_date || null,
        body.start_date || null,
        body.duration_days ?? null,
        endDate,
        body.quantity_dispensed ?? null,
        body.quantity_unit || null,
        body.expiry_date || null,
        body.ingredients_raw || null,
        body.medicine_system || 'allopathic',
        body.status || 'active',
        body.notes || null,
        body.total_doses || null,
        body.reminders_enabled === false ? false : true,
        timing.interval_hours,
        timing.food_relation,
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
    const photos = await pool.query('SELECT * FROM medication_photos WHERE medication_id = $1 ORDER BY created_at ASC', [
      req.params.id,
    ]);

    res.json({
      medication,
      knowledge: await getMedicationKnowledge(medication, req.user.preferred_language),
      forecast,
      photos: photos.rows.map(toPublicRecord),
    });
  } catch (err) {
    next(err);
  }
});

// Lets the user attach up to MAX_PHOTOS_PER_MEDICATION photos of the
// physical medicine to a tracked medication, taken/picked directly (as
// opposed to the scan's own photo auto-attached in medicationScanService.js
// when the medication was read from a prescription/tablet scan).
router.post('/:id/photos', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      const medication = await loadOwnedMedication(currentUserId(req), req.params.id);
      if (!medication) return res.status(404).json({ error: 'Medication not found' });

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
      if (!PHOTO_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: 'Unsupported file type. Use a JPG or PNG photo.' });
      }
      if (req.file.size === 0) {
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      const { rows: countRows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM medication_photos WHERE medication_id = $1',
        [req.params.id]
      );
      if (countRows[0].count >= MAX_PHOTOS_PER_MEDICATION) {
        return res
          .status(400)
          .json({ error: `A medication can have at most ${MAX_PHOTOS_PER_MEDICATION} photos. Delete one first.` });
      }

      const source = PHOTO_SOURCES.has(req.body.source) ? req.body.source : 'file';
      await requireConsent(currentUserId(req), 'medical_record_storage');
      const meta = await secureStore({ userId: currentUserId(req), buffer: req.file.buffer, extension });
      req.file.buffer = null;
      const enc = encryptionInsertParts(meta, 8);
      const { rows } = await pool.query(
        `INSERT INTO medication_photos
           (medication_id, user_id, source, original_filename, mime_type, file_extension, file_size_bytes, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${enc.placeholders.join(', ')})
         RETURNING *`,
        [
          req.params.id,
          currentUserId(req),
          source,
          req.file.originalname,
          req.file.mimetype,
          extension,
          req.file.size,
          ...enc.values,
        ]
      );

      res.status(201).json({ photo: toPublicRecord(rows[0]) });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

// Mints a short-lived, single-photo-scoped token for viewing the photo -
// same reasoning as GET /api/reports/:id/file-url (see routes/reports.js).
router.get('/:id/photos/:photoId/file-url', async (req, res, next) => {
  try {
    const medication = await loadOwnedMedication(currentUserId(req), req.params.id);
    if (!medication) return res.status(404).json({ error: 'Medication not found' });

    const { rows } = await pool.query('SELECT id FROM medication_photos WHERE id = $1 AND medication_id = $2', [
      req.params.photoId,
      req.params.id,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

    const token = signMedicationPhotoDownloadToken({ userId: currentUserId(req), photoId: req.params.photoId });
    res.json({ url: `/api/files/medication-photo/${req.params.photoId}?token=${token}` });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/photos/:photoId', async (req, res, next) => {
  try {
    const medication = await loadOwnedMedication(currentUserId(req), req.params.id);
    if (!medication) return res.status(404).json({ error: 'Medication not found' });

    const { rows } = await pool.query(
      'DELETE FROM medication_photos WHERE id = $1 AND medication_id = $2 RETURNING *',
      [req.params.photoId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

    await deleteStoredFile(rows[0]).catch(() => {});
    await audit.record({ eventType: 'REPORT_DELETED', userId: rows[0].user_id, resourceType: 'medication_photo', purpose: 'user_request' });
    res.status(204).send();
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
  'prescribing_clinic',
  'prescription_date',
  'start_date',
  'duration_days',
  'quantity_dispensed',
  'quantity_unit',
  'expiry_date',
  'ingredients_raw',
  'medicine_system',
  'status',
  'notes',
  'total_doses',
  'reminders_enabled',
  'interval_hours',
  'food_relation',
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
    const timing = validateTiming(next_);
    if (timing.error) return res.status(400).json({ error: timing.error });
    next_.times_of_day = timing.times_of_day;
    next_.interval_hours = timing.interval_hours;
    next_.food_relation = timing.food_relation;
    next_.end_date = computeEndDate(next_.start_date, next_.duration_days);

    const { rows } = await pool.query(
      `UPDATE medications SET
         name = $2, generic_name = $3, brand_name = $4, form = $5, dosage_amount = $6, dosage_unit = $7,
         frequency_per_day = $8, times_of_day = $9, route = $10, instructions = $11, prescribed_for = $12,
         prescribing_doctor = $13, prescribing_clinic = $14, prescription_date = $15, start_date = $16, duration_days = $17, end_date = $18,
         quantity_dispensed = $19, quantity_unit = $20, expiry_date = $21, ingredients_raw = $22,
         medicine_system = $23, status = $24, notes = $25, total_doses = $26, reminders_enabled = $27, interval_hours = $28, food_relation = $29, updated_at = now()
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
        next_.times_of_day,
        next_.route,
        next_.instructions,
        next_.prescribed_for,
        next_.prescribing_doctor,
        next_.prescribing_clinic,
        next_.prescription_date,
        next_.start_date,
        next_.duration_days,
        next_.end_date,
        next_.quantity_dispensed,
        next_.quantity_unit,
        next_.expiry_date,
        next_.ingredients_raw,
        next_.medicine_system,
        next_.status,
        next_.notes,
        next_.total_doses || null,
        next_.reminders_enabled === false ? false : true,
        next_.interval_hours,
        next_.food_relation,
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
    await recordRemoval.deleteMedication(currentUserId(req), req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
