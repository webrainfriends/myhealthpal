const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const provider = require('../extraction/providers/dietPhotoProvider');

// In-process async runner, the same pattern as medicationScanService.js's
// enqueueMedicationScanProcessing - swappable for a real queue later
// without touching route/DB code.
function enqueueDietScanProcessing(scanId) {
  setImmediate(() => {
    processDietScan(scanId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Unhandled error processing diet scan ${scanId}:`, err);
    });
  });
}

// Time-of-day -> meal type, evaluated against the server process's local
// time (the same convention the rest of the app uses for "today" - see
// routes/activity.js - there is no per-user timezone stored anywhere yet).
// Bands are a judgment call, not a clinical standard, and deliberately
// overlap-free and total-coverage so every possible time falls in exactly
// one band; a user can always override the result afterward.
const MEAL_TYPE_BANDS = [
  { type: 'breakfast', startMinute: 4 * 60, endMinute: 11 * 60 }, // 04:00-10:59
  { type: 'lunch', startMinute: 11 * 60, endMinute: 16 * 60 }, // 11:00-15:59
  { type: 'snack', startMinute: 16 * 60, endMinute: 18 * 60 }, // 16:00-17:59 (afternoon snack)
  { type: 'dinner', startMinute: 18 * 60, endMinute: 21 * 60 + 30 }, // 18:00-21:29
  { type: 'supper', startMinute: 21 * 60 + 30, endMinute: 24 * 60 }, // 21:30-23:59
  { type: 'snack', startMinute: 0, endMinute: 4 * 60 }, // 00:00-03:59 (late-night snack)
];

function classifyMealType(date) {
  const d = date instanceof Date ? date : new Date(date);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  const band = MEAL_TYPE_BANDS.find((b) => minuteOfDay >= b.startMinute && minuteOfDay < b.endMinute);
  return band ? band.type : 'snack';
}

async function processDietScan(scanId) {
  const { rows } = await pool.query('SELECT * FROM diet_scans WHERE id = $1', [scanId]);
  const scan = rows[0];
  if (!scan) return;

  await pool.query(
    `UPDATE diet_scans SET ingestion_status = 'Processing', processing_error = NULL, updated_at = now() WHERE id = $1`,
    [scanId]
  );

  const adapter = getAdapter(scan.file_extension);
  const mealType = classifyMealType(scan.consumed_at);

  try {
    if (!adapter) {
      throw new Error(`No ingestion adapter registered for .${scan.file_extension} files`);
    }

    const document = await adapter.extract(scan.storage_path);
    const { items, rawModelOutput } = await provider.extract(document, {
      filePath: scan.storage_path,
      mimeType: scan.mime_type,
    });

    for (const item of items) {
      await pool.query(
        `INSERT INTO food_entries (
           user_id, scan_id, name, brand, quantity_amount, quantity_unit, serving_size_grams,
           calories, protein_g, carbs_g, fat_g, saturated_fat_g, fiber_g, sugar_g, sodium_mg,
           cholesterol_mg, potassium_mg, calcium_mg, iron_mg, vitamin_d_mcg,
           meal_type, consumed_at, source_type, extraction_confidence, needs_quantity, needs_review,
           ai_verified, is_confirmed
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'photo_scan',$23,$24,$25,$26,false)`,
        [
          scan.user_id,
          scanId,
          item.name,
          item.brand,
          item.quantity_amount,
          item.quantity_unit,
          item.serving_size_grams,
          item.calories,
          item.protein_g,
          item.carbs_g,
          item.fat_g,
          item.saturated_fat_g,
          item.fiber_g,
          item.sugar_g,
          item.sodium_mg,
          item.cholesterol_mg,
          item.potassium_mg,
          item.calcium_mg,
          item.iron_mg,
          item.vitamin_d_mcg,
          mealType,
          scan.consumed_at,
          item.confidence,
          item.needs_quantity,
          item.needs_review,
          // The AI could estimate nutrition for this item exactly when it
          // didn't need a quantity to be supplied first - a needs_quantity
          // item has no AI-sourced numbers yet, so it isn't "verified" until
          // one is provided (via PATCH or the estimate endpoint).
          !item.needs_quantity,
        ]
      );
    }

    await pool.query(
      `UPDATE diet_scans SET ingestion_status = $2, raw_model_output = $3, updated_at = now() WHERE id = $1`,
      [scanId, items.length > 0 ? 'Needs Review' : 'Completed', rawModelOutput ? JSON.stringify(rawModelOutput) : null]
    );
  } catch (err) {
    await pool.query(
      `UPDATE diet_scans SET ingestion_status = 'Failed', processing_error = $2, updated_at = now() WHERE id = $1`,
      [scanId, err.message]
    );
  }
}

module.exports = { enqueueDietScanProcessing, processDietScan, classifyMealType };
