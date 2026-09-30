const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf, maxBytesFor } = require('../middleware/upload');
const { enqueueProcessing } = require('../services/ingestionService');
const { enqueueDietScanProcessing } = require('../diet/dietScanService');
const { enqueueScheduleImportProcessing } = require('../dietSchedule/scheduleImportService');
const { enqueueInsuranceProcessing } = require('../insurance/insuranceImportService');
const { classifyUpload, CATEGORIES, CATEGORY_LABELS } = require('../services/documentClassificationService');
const { secureStore, encryptionInsertParts } = require('../security/secureUpload');
const { requireConsent } = require('../security/consentService');
const { toPublicRecord } = require('../security/reportAccess');
const audit = require('../security/auditLog');

const router = express.Router();

// One upload entry point for every kind of document: the file is stored once
// in the encrypted vault, classified (services/documentClassificationService),
// and then handed to the same pipeline the dedicated endpoints use - lab
// result (reports.js), food photo (diet.js), diet schedule (dietSchedules.js)
// or insurance policy (insurance.js). The dedicated endpoints stay as they
// are; the INSERTs below mirror theirs.

// What each pipeline can actually read. A classification the file's format
// can't satisfy (say a food verdict on a PDF) falls back to the lab-report
// pipeline rather than failing the upload.
const EXTENSIONS_BY_CATEGORY = {
  lab_report: null, // anything the upload middleware already accepted
  insurance: new Set(['pdf', 'docx', 'doc', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'csv']),
  food: new Set(['jpg', 'jpeg', 'png']),
  diet_schedule: new Set(['csv', 'xls', 'xlsx', 'doc', 'docx', 'pdf', 'jpg', 'jpeg', 'png']),
};

function supports(category, extension) {
  const allowed = EXTENSIONS_BY_CATEGORY[category];
  return allowed === null || allowed.has(extension);
}

function currentUserId(req) {
  return req.user.id;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

// Where the mobile app should send the person next.
function nextStep(category, record) {
  switch (category) {
    case 'insurance':
      return { screen: 'InsurancePolicy', params: { policyId: record.id } };
    case 'food':
      return { screen: 'DietScanReview', params: { scanId: record.id } };
    case 'diet_schedule':
      return { screen: 'DietSchedules', params: { importId: record.id } };
    default:
      return { screen: 'ReportDetail', params: { reportId: record.id } };
  }
}

async function insertRecord(category, { userId, file, extension, meta, body }) {
  const base = [userId, file.originalname, file.mimetype, extension, file.size];
  switch (category) {
    case 'insurance': {
      const enc = encryptionInsertParts(meta, 6);
      const { rows } = await pool.query(
        `INSERT INTO insurance_policies
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, ${enc.placeholders.join(', ')})
         RETURNING id`,
        [...base, ...enc.values]
      );
      enqueueInsuranceProcessing(rows[0].id);
      return { id: rows[0].id };
    }
    case 'food': {
      const consumed = body.consumed_at ? new Date(body.consumed_at) : new Date();
      const consumedAt = Number.isNaN(consumed.getTime()) ? new Date() : consumed;
      const enc = encryptionInsertParts(meta, 7);
      const { rows } = await pool.query(
        `INSERT INTO diet_scans
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, consumed_at, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, $6, ${enc.placeholders.join(', ')})
         RETURNING id`,
        [...base, consumedAt, ...enc.values]
      );
      enqueueDietScanProcessing(rows[0].id);
      return { id: rows[0].id };
    }
    case 'diet_schedule': {
      const startDate = body.start_date && !Number.isNaN(new Date(body.start_date).getTime()) ? String(body.start_date).slice(0, 10) : isoToday();
      // The 15-day maximum keeps every day the document has; the import
      // then sizes the schedule to it (duration_auto).
      const enc = encryptionInsertParts(meta, 7);
      const { rows } = await pool.query(
        `INSERT INTO diet_schedule_imports
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, requested_duration_days, requested_start_date, duration_auto, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, 15, $6, true, ${enc.placeholders.join(', ')})
         RETURNING id`,
        [...base, startDate, ...enc.values]
      );
      enqueueScheduleImportProcessing(rows[0].id);
      return { id: rows[0].id };
    }
    default: {
      const enc = encryptionInsertParts(meta, 6);
      const { rows } = await pool.query(
        `INSERT INTO reports
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, ${enc.columns.join(', ')})
         VALUES ($1, $2, $3, $4, $5, ${enc.placeholders.join(', ')})
         RETURNING *`,
        [...base, ...enc.values]
      );
      const report = rows[0];
      await audit.record({ eventType: 'REPORT_ENCRYPTED', userId, reportId: report.id, purpose: 'report_upload' });
      enqueueProcessing(report.id);
      return { id: report.id, report: toPublicRecord(report) };
    }
  }
}

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File exceeds the ${Math.round(Math.max(config.maxUploadBytes, config.maxHealthExportBytes) / (1024 * 1024))}MB upload limit.`,
        });
      }
      if (err) return next(err);
      if (req.fileValidationError) return res.status(400).json({ error: req.fileValidationError });
      if (!req.file) return res.status(400).json({ error: 'No file was provided. Attach a file under the "file" field.' });

      const extension = extensionOf(req.file.originalname);
      const limitBytes = maxBytesFor(extension);
      if (req.file.size > limitBytes) {
        return res.status(400).json({ error: `File exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB upload limit.` });
      }
      if (req.file.size === 0) return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });

      // 'auto' (or absent) means "work it out"; anything else is the
      // person's own choice and is never second-guessed.
      const requested = String(req.body.category || 'auto').trim();
      if (requested !== 'auto' && !CATEGORIES.includes(requested)) {
        return res.status(400).json({ error: `category must be "auto" or one of: ${CATEGORIES.join(', ')}.` });
      }
      if (requested !== 'auto' && !supports(requested, extension)) {
        return res.status(400).json({
          error: `A ${CATEGORY_LABELS[requested].toLowerCase()} can't be read from a .${extension} file.`,
        });
      }

      const userId = currentUserId(req);
      await requireConsent(userId, 'medical_record_storage');
      await audit.record({ eventType: 'REPORT_UPLOAD_STARTED', userId, purpose: 'smart_upload' });

      // Validated, scanned and encrypted straight from memory - only
      // ciphertext ever reaches disk. Classification reads the same
      // in-memory bytes, so the plaintext is never written anywhere.
      const meta = await secureStore({ userId, buffer: req.file.buffer, extension });

      let decision;
      if (requested !== 'auto') {
        decision = { category: requested, confidence: 1, method: 'user', reason: 'You chose this type.' };
      } else {
        decision = await classifyUpload({
          buffer: req.file.buffer,
          extension,
          mimeType: req.file.mimetype,
          filename: req.file.originalname,
          userId,
        });
        if (!supports(decision.category, extension)) {
          decision = {
            category: 'lab_report',
            confidence: 0.3,
            method: 'default',
            reason: `This looks like a ${CATEGORY_LABELS[decision.category].toLowerCase()}, but that can't be read from a .${extension} file, so it was filed as a lab result.`,
          };
        }
      }
      req.file.buffer = null;

      const record = await insertRecord(decision.category, { userId, file: req.file, extension, meta, body: req.body });

      res.status(201).json({
        category: decision.category,
        categoryLabel: CATEGORY_LABELS[decision.category],
        confidence: decision.confidence,
        method: decision.method,
        reason: decision.reason || null,
        // Below this, the app asks the person to check the type.
        uncertain: decision.method !== 'user' && decision.confidence < 0.6,
        record: { id: record.id },
        report: record.report || null,
        next: nextStep(decision.category, record),
      });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

module.exports = router;
