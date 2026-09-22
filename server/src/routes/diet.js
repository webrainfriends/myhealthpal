const express = require('express');
const fs = require('fs');
const pool = require('../db/pool');
const config = require('../config');
const { upload, extensionOf } = require('../middleware/upload');
const { enqueueDietScanProcessing, classifyMealType } = require('../diet/dietScanService');
const { getOrGenerateRecommendations, generateRecommendations } = require('../diet/dietInsightService');

const router = express.Router();

// Diet photos are always a single food/drink photo - narrower than the
// general report upload's SUPPORTED_EXTENSIONS, same idea as medication
// scans (routes/medications.js) but photo-only (no prescription-style PDF
// case here).
const SCAN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

const QUANTITY_UNITS = new Set(['g', 'ml', 'serving', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other']);
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'snack', 'dinner', 'supper']);

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

function parseConsumedAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

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
        return res.status(400).json({ error: 'No file was provided. Attach a photo under the "file" field.' });
      }

      const extension = extensionOf(req.file.originalname);
      if (!SCAN_EXTENSIONS.has(extension)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Unsupported file type. Use a JPG or PNG photo.' });
      }
      if (req.file.size === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'The uploaded file is empty or corrupt.' });
      }

      const consumedAt = parseConsumedAt(req.body.consumed_at);
      const { rows } = await pool.query(
        `INSERT INTO diet_scans
           (user_id, original_filename, mime_type, file_extension, file_size_bytes, storage_path, consumed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [currentUserId(req), req.file.originalname, req.file.mimetype, extension, req.file.size, req.file.path, consumedAt]
      );
      const scan = rows[0];

      enqueueDietScanProcessing(scan.id);

      res.status(201).json({ scan });
    } catch (dbErr) {
      next(dbErr);
    }
  });
});

router.get('/scans/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM diet_scans WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const scan = rows[0];
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    const entries = await pool.query('SELECT * FROM food_entries WHERE scan_id = $1 ORDER BY created_at ASC', [
      req.params.id,
    ]);
    res.json({ scan, entries: entries.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/scans/:id/retry', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM diet_scans WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const scan = rows[0];
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    if (scan.ingestion_status === 'Processing') {
      return res.status(409).json({ error: 'Scan is already processing.' });
    }

    await pool.query('DELETE FROM food_entries WHERE scan_id = $1 AND is_confirmed = false', [req.params.id]);
    enqueueDietScanProcessing(scan.id);
    res.json({ status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// Lists entries in a date window - a single `date` (YYYY-MM-DD) for one
// day, or `from`/`to` for a range; defaults to today when neither is given.
// `unconfirmed=true` ignores the date window entirely and returns every
// not-yet-reviewed entry regardless of when it was logged - used by the
// "needs review" banner, which must find a pending scan even if it was
// captured on an earlier day than "today".
router.get('/entries', async (req, res, next) => {
  try {
    const userId = currentUserId(req);

    if (req.query.unconfirmed === 'true') {
      const { rows } = await pool.query(
        `SELECT * FROM food_entries WHERE user_id = $1 AND is_confirmed = false ORDER BY consumed_at DESC`,
        [userId]
      );
      return res.json({ entries: rows });
    }

    let from;
    let to;
    if (req.query.date) {
      from = `${req.query.date}T00:00:00.000Z`;
      to = `${req.query.date}T23:59:59.999Z`;
    } else if (req.query.from || req.query.to) {
      from = req.query.from ? `${req.query.from}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
      to = req.query.to ? `${req.query.to}T23:59:59.999Z` : new Date().toISOString();
    } else {
      const today = new Date().toISOString().slice(0, 10);
      from = `${today}T00:00:00.000Z`;
      to = `${today}T23:59:59.999Z`;
    }

    const { rows } = await pool.query(
      `SELECT * FROM food_entries WHERE user_id = $1 AND consumed_at BETWEEN $2 AND $3
       ORDER BY consumed_at ASC`,
      [userId, from, to]
    );
    res.json({ entries: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/entries/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM food_entries WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

const NUMERIC_FIELDS = ['quantity_amount', 'serving_size_grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'];

function validateEntryBody(body) {
  if (!body.name || !String(body.name).trim()) return 'name is required.';
  if (body.quantity_unit && !QUANTITY_UNITS.has(body.quantity_unit)) return 'quantity_unit is not a recognized unit.';
  if (body.meal_type && !MEAL_TYPES.has(body.meal_type)) return 'meal_type is not a recognized meal.';
  for (const field of NUMERIC_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && !Number.isFinite(Number(body[field]))) {
      return `${field} must be a number.`;
    }
  }
  return null;
}

// Manual entry: trusted immediately (is_confirmed = true), unlike a
// scanned candidate - the same distinction routes/medications.js makes
// between POST /scans (unconfirmed) and POST / (confirmed).
router.post('/entries', async (req, res, next) => {
  try {
    const body = req.body || {};
    const error = validateEntryBody(body);
    if (error) return res.status(400).json({ error });

    const consumedAt = parseConsumedAt(body.consumed_at);
    const mealType = body.meal_type || classifyMealType(consumedAt);

    const { rows } = await pool.query(
      `INSERT INTO food_entries (
         user_id, name, brand, quantity_amount, quantity_unit, serving_size_grams,
         calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg,
         meal_type, consumed_at, source_type, notes, is_confirmed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual',$16,true)
       RETURNING *`,
      [
        currentUserId(req),
        body.name,
        body.brand || null,
        body.quantity_amount ?? null,
        body.quantity_unit || null,
        body.serving_size_grams ?? null,
        body.calories ?? null,
        body.protein_g ?? null,
        body.carbs_g ?? null,
        body.fat_g ?? null,
        body.fiber_g ?? null,
        body.sugar_g ?? null,
        body.sodium_mg ?? null,
        mealType,
        consumedAt,
        body.notes || null,
      ]
    );
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

const EDITABLE_FIELDS = [
  'name', 'brand', 'quantity_amount', 'quantity_unit', 'serving_size_grams',
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg',
  'meal_type', 'consumed_at', 'notes',
];

router.patch('/entries/:id', async (req, res, next) => {
  try {
    const current = await pool.query('SELECT * FROM food_entries WHERE id = $1 AND user_id = $2', [
      req.params.id,
      currentUserId(req),
    ]);
    const existing = current.rows[0];
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const body = req.body || {};
    const error = validateEntryBody({ ...existing, ...body });
    if (error) return res.status(400).json({ error });

    const next_ = { ...existing };
    for (const field of EDITABLE_FIELDS) {
      if (body[field] === undefined) continue;
      next_[field] = field === 'consumed_at' ? parseConsumedAt(body[field]) : body[field];
    }
    // A consumed_at edit re-derives meal_type unless the same request also
    // explicitly set meal_type - otherwise moving a photo's logged time
    // (e.g. correcting an upload delay) would silently strand it in the
    // wrong meal bucket.
    if (body.consumed_at !== undefined && body.meal_type === undefined) {
      next_.meal_type = classifyMealType(next_.consumed_at);
    }
    // Editing a scanned candidate's quantity/calories is how a person
    // answers "needs quantity" - once real numbers are provided, the item
    // no longer needs that particular flag.
    const providedQuantity = body.quantity_amount !== undefined || body.calories !== undefined;
    const needsQuantity = providedQuantity ? false : existing.needs_quantity;

    const { rows } = await pool.query(
      `UPDATE food_entries SET
         name = $2, brand = $3, quantity_amount = $4, quantity_unit = $5, serving_size_grams = $6,
         calories = $7, protein_g = $8, carbs_g = $9, fat_g = $10, fiber_g = $11, sugar_g = $12, sodium_mg = $13,
         meal_type = $14, consumed_at = $15, notes = $16, needs_quantity = $17, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        next_.name,
        next_.brand,
        next_.quantity_amount,
        next_.quantity_unit,
        next_.serving_size_grams,
        next_.calories,
        next_.protein_g,
        next_.carbs_g,
        next_.fat_g,
        next_.fiber_g,
        next_.sugar_g,
        next_.sodium_mg,
        next_.meal_type,
        next_.consumed_at,
        next_.notes,
        needsQuantity,
      ]
    );
    res.json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/entries/:id/confirm', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE food_entries SET is_confirmed = true, needs_review = false, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, currentUserId(req)]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/entries/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('DELETE FROM food_entries WHERE id = $1 AND user_id = $2 RETURNING id', [
      req.params.id,
      currentUserId(req),
    ]);
    if (rows.length === 0) return res.status(404).json({ error: 'Entry not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Per-day totals + meal breakdown for a recent window - the diet analog of
// GET /api/activity/summary.
router.get('/summary', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 90);

    const { rows } = await pool.query(
      `SELECT id, name, meal_type, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, consumed_at, is_confirmed, needs_quantity, needs_review
       FROM food_entries
       WHERE user_id = $1 AND consumed_at >= CURRENT_DATE - ($2::int - 1) AND is_confirmed = true
       ORDER BY consumed_at ASC`,
      [userId, days]
    );

    const byDay = new Map();
    for (const row of rows) {
      const key = new Date(row.consumed_at).toISOString().slice(0, 10);
      const day = byDay.get(key) || { date: key, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, meals: { breakfast: [], lunch: [], snack: [], dinner: [], supper: [] } };
      day.calories += Number(row.calories) || 0;
      day.protein_g += Number(row.protein_g) || 0;
      day.carbs_g += Number(row.carbs_g) || 0;
      day.fat_g += Number(row.fat_g) || 0;
      day.fiber_g += Number(row.fiber_g) || 0;
      day.sugar_g += Number(row.sugar_g) || 0;
      day.sodium_mg += Number(row.sodium_mg) || 0;
      day.meals[row.meal_type].push({ id: row.id, name: row.name, calories: row.calories });
      byDay.set(key, day);
    }

    const history = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      history.push(byDay.get(key) || { date: key, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, meals: { breakfast: [], lunch: [], snack: [], dinner: [], supper: [] } });
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const today = byDay.get(todayKey) || history[history.length - 1];

    const pendingReview = await pool.query(
      `SELECT count(*)::int AS count FROM food_entries WHERE user_id = $1 AND is_confirmed = false`,
      [userId]
    );

    res.json({ today, history, pendingReviewCount: pendingReview.rows[0].count });
  } catch (err) {
    next(err);
  }
});

router.get('/recommendations', async (req, res, next) => {
  try {
    const userId = currentUserId(req);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 14, 3), 90);
    const forceRefresh = req.query.refresh === 'true';

    const recommendation = forceRefresh
      ? await generateRecommendations(userId, days)
      : await getOrGenerateRecommendations(userId, { windowDays: days });

    res.json({ recommendation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
