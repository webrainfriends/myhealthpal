const pool = require('../db/pool');
const dietRecipeService = require('../diet/dietRecipeService');
const recipeCatalogService = require('../recipes/recipeCatalogService');
const { logError } = require('../lib/safeLog');

// Ensures every diet schedule entry ends up with a full, real recipe
// (requirement 4) - a manual entry starts as just a dish name, and an
// imported entry usually has only whatever name was written/printed on the
// source document; neither has ingredients or steps until this runs.
//
// Reuses dietRecipeService.generateRecipe() exactly as-is: its existing
// RECIPE_TOOL/SYSTEM_PROMPT already treat free-text `preferences` as a hard
// constraint, so asking it to "recreate this specific dish" needs no new
// tool or prompt of its own.

async function fetchEntryWithOwner(entryId) {
  const { rows } = await pool.query(
    `SELECT e.*, s.user_id FROM diet_schedule_entries e JOIN diet_schedules s ON s.id = e.schedule_id WHERE e.id = $1`,
    [entryId]
  );
  return rows[0] || null;
}

async function backfillEntryById(entryId) {
  const entry = await fetchEntryWithOwner(entryId);
  if (!entry || entry.recipe_status === 'generated') return;

  await pool.query(`UPDATE diet_schedule_entries SET recipe_status = 'generating', updated_at = now() WHERE id = $1`, [
    entryId,
  ]);

  try {
    const { recipe } = await dietRecipeService.generateRecipe(entry.user_id, {
      mealType: entry.meal_type,
      preferences: `Recreate this specific dish as closely as possible: "${entry.dish_name}".`,
    });
    if (!recipe) throw new Error('The AI did not return a usable recipe.');

    const saved = await dietRecipeService.saveScheduleRecipeSuggestion(entry.user_id, recipe, entry.meal_type);

    const preferences = await dietRecipeService.fetchRecipePreferences(entry.user_id);
    const canonicalId = await recipeCatalogService.linkOrCreate(saved.id, saved, {
      cuisine: preferences.cuisines[0] || null,
      dietType: preferences.dietTypes[0] || null,
    });
    if (canonicalId) await recipeCatalogService.recordScheduleAdd(canonicalId);

    await pool.query(
      `UPDATE diet_schedule_entries SET recipe_suggestion_id = $1, recipe_status = 'generated', updated_at = now() WHERE id = $2`,
      [saved.id, entryId]
    );
  } catch (err) {
    await pool.query(`UPDATE diet_schedule_entries SET recipe_status = 'failed', updated_at = now() WHERE id = $1`, [
      entryId,
    ]);
  }
}

// In-process async runner, the same pattern as dietScanService.js's
// enqueueDietScanProcessing - swappable for a real queue later with no
// route/DB changes.
function enqueueBackfillEntry(entryId) {
  setImmediate(() => {
    backfillEntryById(entryId).catch((err) => logError(`Unhandled error backfilling diet schedule entry ${entryId}`, err));
  });
}

// Backfills every not-yet-generated entry in a schedule, one at a time (a
// day at a time in order) rather than concurrently - keeps AI usage/cost
// predictable per schedule and avoids one failing entry's error handling
// racing another's.
function enqueueBackfill(scheduleId) {
  setImmediate(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT id FROM diet_schedule_entries WHERE schedule_id = $1 AND recipe_status != 'generated' ORDER BY day_number ASC, meal_type ASC`,
        [scheduleId]
      );
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        await backfillEntryById(row.id);
      }
    } catch (err) {
      logError(`Unhandled error backfilling diet schedule ${scheduleId}`, err);
    }
  });
}

module.exports = { enqueueBackfill, enqueueBackfillEntry, backfillEntryById };
