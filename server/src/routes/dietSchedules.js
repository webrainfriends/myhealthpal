const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { secureStore, encryptionInsertParts } = require('../security/secureUpload');
const { requireConsent } = require('../security/consentService');
const scheduleService = require('../dietSchedule/scheduleService');
const scheduleGenerationService = require('../dietSchedule/scheduleGenerationService');
const scheduleImpactService = require('../dietSchedule/scheduleImpactService');
const { enqueueScheduleImportProcessing } = require('../dietSchedule/scheduleImportService');

const router = express.Router();

// Every format the report-upload pipeline already supports for a document
// (adapters/index.js) - a diet schedule can be typed up in any of these the
// same way a lab report can be, including a photo of a handwritten plan.
const IMPORT_EXTENSIONS = new Set(['csv', 'xls', 'xlsx', 'doc', 'docx', 'pdf', 'jpg', 'jpeg', 'png']);

function currentUserId(req) {
  return req.user.id;
}

function sendServiceError(res, next, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.message && err.message.includes('ANTHROPIC_API_KEY')) return res.status(503).json({ error: err.message });
  next(err);
}

router.get('/', async (req, res, next) => {
  try {
    const schedules = await scheduleService.listSchedules(currentUserId(req));
    res.json({ schedules });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const schedule = await scheduleService.createManualSchedule(currentUserId(req), {
      title: body.title,
      durationDays: body.duration_days,
      startDate: body.start_date,
      entries: Array.isArray(body.entries)
        ? body.entries.map((e) => ({ dayNumber: e.day_number, mealType: e.meal_type, dishName: e.dish_name }))
        : [],
    });
    res.status(201).json({ schedule });
  } catch (err) {
    sendServiceError(res, next, err);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const body = req.body || {};
    const schedule = await scheduleGenerationService.generateFromKitchen(currentUserId(req), {
      title: body.title,
      durationDays: body.duration_days,
      startDate: body.start_date,
      kitchenItemIds: Array.isArray(body.kitchen_item_ids) ? body.kitchen_item_ids : [],
      mealTypesPerDay: Array.isArray(body.meal_types_per_day) ? body.meal_types_per_day : undefined,
    });
    res.status(201).json({ schedule });
  } catch (err) {
    sendServiceError(res, next, err);
  }
});

router.post('/import', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `File exceeds the ${Math.round(config.maxUploadBytes / (1024 * 1024))}MB upload limit.` });
      }
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: 'No file was provided. Attach a document under the "file" field.' });

      const extension = extensionOf(req.file.originalname);
      if (!IMPORT_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: 'Unsupported file type. Use a PDF, Word, Excel, CSV, or photo (JPG/PNG).' });
      }
      if (req.file.size === 0) return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });

      const durationDays = Number(req.body.duration_days);
      if (!scheduleService.DURATIONS.includes(durationDays)) {
        return res.status(400).json({ error: 'duration_days must be 7 or 15.' });
      }
      const startDate = req.body.start_date;
      if (!startDate || Number.isNaN(new Date(startDate).getTime())) {
        return res.status(400).json({ error: 'start_date is required (YYYY-MM-DD).' });
      }

      await requireConsent(currentUserId(req), 'medical_record_storage');
      const meta = await secureStore({ userId: currentUserId(req), buffer: req.file.buffer, extension });
      req.file.buffer = null;
      const enc = encryptionInsertParts(meta, 8);
      const { rows } = await pool.query(
        `INSERT INTO diet_schedule_imports
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, requested_duration_days, requested_start_date, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, $6, $7, ${enc.placeholders.join(', ')})
         RETURNING *`,
        [currentUserId(req), req.file.originalname, req.file.mimetype, extension, req.file.size, durationDays, startDate, ...enc.values]
      );
      const importRecord = rows[0];

      enqueueScheduleImportProcessing(importRecord.id);

      res.status(202).json({
        import: {
          id: importRecord.id,
          ingestionStatus: importRecord.ingestion_status,
          requestedDurationDays: importRecord.requested_duration_days,
          requestedStartDate: importRecord.requested_start_date,
        },
      });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

router.get('/imports/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM diet_schedule_imports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'Import not found.' });

    const { rows: scheduleRows } = await pool.query('SELECT id FROM diet_schedules WHERE import_id = $1', [record.id]);
    res.json({
      import: {
        id: record.id,
        ingestionStatus: record.ingestion_status,
        processingError: record.processing_error,
        requestedDurationDays: record.requested_duration_days,
        requestedStartDate: record.requested_start_date,
      },
      scheduleId: scheduleRows[0]?.id || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const schedule = await scheduleService.getScheduleWithEntries(currentUserId(req), req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await scheduleService.deleteSchedule(currentUserId(req), req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Schedule not found.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch('/entries/:entryId', async (req, res, next) => {
  try {
    const body = req.body || {};
    const entry = await scheduleService.updateEntry(currentUserId(req), req.params.entryId, {
      dishName: body.dish_name,
      mealType: body.meal_type,
    });
    if (!entry) return res.status(404).json({ error: 'Schedule entry not found.' });
    res.json({ entry });
  } catch (err) {
    sendServiceError(res, next, err);
  }
});

router.post('/entries/:entryId/log', async (req, res, next) => {
  try {
    const consumedAt = req.body?.consumed_at ? new Date(req.body.consumed_at) : undefined;
    const foodEntry = await scheduleService.logScheduleEntry(currentUserId(req), req.params.entryId, { consumedAt });
    if (!foodEntry) return res.status(404).json({ error: 'Schedule entry not found or has no generated recipe yet.' });
    res.status(201).json({ entry: foodEntry });
  } catch (err) {
    next(err);
  }
});

router.post('/entries/:entryId/retry-recipe', async (req, res, next) => {
  try {
    const retried = await scheduleService.retryEntryRecipe(currentUserId(req), req.params.entryId);
    if (!retried) return res.status(404).json({ error: 'Schedule entry not found.' });
    res.json({ status: 'queued' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/impact', async (req, res, next) => {
  try {
    const schedule = await scheduleService.getScheduleWithEntries(currentUserId(req), req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });
    const impact = await scheduleImpactService.getOrComputeImpactFlags(currentUserId(req), req.params.id);
    res.json({ impact });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/impact/refresh', async (req, res, next) => {
  try {
    const schedule = await scheduleService.getScheduleWithEntries(currentUserId(req), req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });
    const impact = await scheduleImpactService.generateImpactFlags(currentUserId(req), req.params.id);
    res.json({ impact });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
