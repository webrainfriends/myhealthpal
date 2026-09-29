const pool = require('../db/pool');
const dietRecipeService = require('../diet/dietRecipeService');
const recipeCatalogService = require('../recipes/recipeCatalogService');
const recipeBackfillService = require('./recipeBackfillService');

// CRUD/lifecycle for a diet schedule (024_diet_schedules.sql) and its
// per-day/meal entries. Generation (from a kitchen selection) lives in
// scheduleGenerationService.js; import lives in scheduleImportService.js;
// this module owns manual creation plus the operations every schedule
// (regardless of how it was created) shares - listing, editing an entry,
// logging one, deleting the schedule.

const DURATIONS = [7, 15];
const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validateManualEntries(entries, durationDays) {
  if (!Array.isArray(entries) || entries.length === 0) return 'entries must be a non-empty array.';
  for (const e of entries) {
    if (!e || typeof e !== 'object') return 'Each entry must be an object.';
    if (!Number.isInteger(e.dayNumber) || e.dayNumber < 1 || e.dayNumber > durationDays) {
      return `dayNumber must be an integer between 1 and ${durationDays}.`;
    }
    if (!MEAL_TYPES.includes(e.mealType)) return `mealType must be one of ${MEAL_TYPES.join(', ')}.`;
    if (!e.dishName || !String(e.dishName).trim()) return 'dishName is required for every entry.';
  }
  return null;
}

async function insertEntries(scheduleId, startDate, entries) {
  const inserted = [];
  for (const e of entries) {
    const scheduledDate = addDays(startDate, e.dayNumber - 1);
    const { rows } = await pool.query(
      `INSERT INTO diet_schedule_entries (schedule_id, day_number, scheduled_date, meal_type, dish_name, raw_import_text, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [scheduleId, e.dayNumber, scheduledDate, e.mealType, String(e.dishName).trim(), e.rawImportText || null, Boolean(e.needsReview)]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

// A manual entry starts as just a dish name with no recipe, the same as an
// imported one - backfill generates a full recipe for every one of them
// (requirement 4: every schedule entry ends up with a real recipe).
async function createManualSchedule(userId, { title, durationDays, startDate, entries }) {
  const duration = Number(durationDays);
  if (!DURATIONS.includes(duration)) throw httpError('durationDays must be 7 or 15.', 400);
  if (!startDate || Number.isNaN(new Date(startDate).getTime())) throw httpError('startDate is required (YYYY-MM-DD).', 400);

  const entriesError = validateManualEntries(entries, duration);
  if (entriesError) throw httpError(entriesError, 400);

  const { rows } = await pool.query(
    `INSERT INTO diet_schedules (user_id, title, duration_days, start_date, source_type)
     VALUES ($1, $2, $3, $4, 'manual') RETURNING *`,
    [userId, title && title.trim() ? title.trim() : `${duration}-day diet schedule`, duration, startDate]
  );
  const schedule = rows[0];
  await insertEntries(schedule.id, startDate, entries);
  recipeBackfillService.enqueueBackfill(schedule.id);

  return getScheduleWithEntries(userId, schedule.id);
}

async function listSchedules(userId) {
  const { rows } = await pool.query('SELECT * FROM diet_schedules WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return rows;
}

function mapEntryRow(row) {
  return {
    id: row.id,
    dayNumber: row.day_number,
    scheduledDate: row.scheduled_date,
    mealType: row.meal_type,
    dishName: row.dish_name,
    rawImportText: row.raw_import_text,
    needsReview: row.needs_review,
    recipeStatus: row.recipe_status,
    foodEntryId: row.food_entry_id,
    recipe: row.recipe_id
      ? {
          id: row.recipe_id,
          title: row.recipe_title,
          description: row.recipe_description,
          servings: row.recipe_servings != null ? Number(row.recipe_servings) : null,
          prepTimeMinutes: row.recipe_prep_time_minutes,
          cookTimeMinutes: row.recipe_cook_time_minutes,
          ingredients: row.recipe_ingredients || [],
          instructions: row.recipe_instructions || [],
          dietaryTags: row.recipe_dietary_tags || [],
          whyThisRecipe: row.recipe_why_this_recipe,
        }
      : null,
  };
}

async function getScheduleWithEntries(userId, scheduleId) {
  const { rows: scheduleRows } = await pool.query('SELECT * FROM diet_schedules WHERE id = $1 AND user_id = $2', [
    scheduleId,
    userId,
  ]);
  const schedule = scheduleRows[0];
  if (!schedule) return null;

  const { rows: entryRows } = await pool.query(
    `SELECT e.*,
            rs.id AS recipe_id, rs.title AS recipe_title, rs.description AS recipe_description,
            rs.servings AS recipe_servings, rs.prep_time_minutes AS recipe_prep_time_minutes,
            rs.cook_time_minutes AS recipe_cook_time_minutes, rs.ingredients AS recipe_ingredients,
            rs.instructions AS recipe_instructions, rs.dietary_tags AS recipe_dietary_tags,
            rs.why_this_recipe AS recipe_why_this_recipe
     FROM diet_schedule_entries e
     LEFT JOIN recipe_suggestions rs ON rs.id = e.recipe_suggestion_id
     WHERE e.schedule_id = $1
     ORDER BY e.day_number ASC, e.meal_type ASC`,
    [scheduleId]
  );

  return { ...schedule, entries: entryRows.map(mapEntryRow) };
}

// Loads a raw entry row (no recipe join) scoped to the owning user - shared
// by updateEntry/logScheduleEntry/retryEntryRecipe so ownership is always
// checked via a join back to diet_schedules, never trusted from the id alone.
async function fetchOwnedEntry(userId, entryId) {
  const { rows } = await pool.query(
    `SELECT e.* FROM diet_schedule_entries e JOIN diet_schedules s ON s.id = e.schedule_id
     WHERE e.id = $1 AND s.user_id = $2`,
    [entryId, userId]
  );
  return rows[0] || null;
}

// Same recipe-joined shape/mapping getScheduleWithEntries uses for a whole
// schedule, for a single entry - keeps PATCH .../entries/:id returning the
// same camelCase shape (with a nested recipe, when generated) that GET
// .../:id's entries array does, instead of a raw snake_case row.
async function fetchOwnedEntryWithRecipe(userId, entryId) {
  const { rows } = await pool.query(
    `SELECT e.*,
            rs.id AS recipe_id, rs.title AS recipe_title, rs.description AS recipe_description,
            rs.servings AS recipe_servings, rs.prep_time_minutes AS recipe_prep_time_minutes,
            rs.cook_time_minutes AS recipe_cook_time_minutes, rs.ingredients AS recipe_ingredients,
            rs.instructions AS recipe_instructions, rs.dietary_tags AS recipe_dietary_tags,
            rs.why_this_recipe AS recipe_why_this_recipe
     FROM diet_schedule_entries e
     JOIN diet_schedules s ON s.id = e.schedule_id
     LEFT JOIN recipe_suggestions rs ON rs.id = e.recipe_suggestion_id
     WHERE e.id = $1 AND s.user_id = $2`,
    [entryId, userId]
  );
  return rows[0] ? mapEntryRow(rows[0]) : null;
}

// Editing the dish name is how a person corrects a misread import or
// changes their mind on a manual entry - either way, the recipe it had (if
// any) no longer matches, so it resets to pending and re-enqueues backfill.
async function updateEntry(userId, entryId, patch) {
  const existing = await fetchOwnedEntry(userId, entryId);
  if (!existing) return null;

  if (patch.mealType !== undefined && !MEAL_TYPES.includes(patch.mealType)) {
    throw httpError(`mealType must be one of ${MEAL_TYPES.join(', ')}.`, 400);
  }

  const nextDishName = patch.dishName !== undefined ? String(patch.dishName).trim() : existing.dish_name;
  if (!nextDishName) throw httpError('dishName cannot be empty.', 400);
  const nextMealType = patch.mealType !== undefined ? patch.mealType : existing.meal_type;
  const dishNameChanged = nextDishName !== existing.dish_name;

  await pool.query(
    `UPDATE diet_schedule_entries SET
       dish_name = $1, meal_type = $2,
       recipe_status = CASE WHEN $3 THEN 'pending' ELSE recipe_status END,
       recipe_suggestion_id = CASE WHEN $3 THEN NULL ELSE recipe_suggestion_id END,
       needs_review = false, updated_at = now()
     WHERE id = $4`,
    [nextDishName, nextMealType, dishNameChanged, entryId]
  );

  if (dishNameChanged) recipeBackfillService.enqueueBackfillEntry(entryId);
  return fetchOwnedEntryWithRecipe(userId, entryId);
}

async function retryEntryRecipe(userId, entryId) {
  const existing = await fetchOwnedEntry(userId, entryId);
  if (!existing) return null;
  await pool.query(`UPDATE diet_schedule_entries SET recipe_status = 'pending', updated_at = now() WHERE id = $1`, [entryId]);
  recipeBackfillService.enqueueBackfillEntry(entryId);
  return true;
}

// Converts a schedule entry's generated recipe into a food_entries row -
// same "select this as my diet" action dietRecipeService.logRecipeSuggestion
// already provides the Recipes feed, reused here rather than reimplemented.
async function logScheduleEntry(userId, entryId, { consumedAt } = {}) {
  const existing = await fetchOwnedEntry(userId, entryId);
  if (!existing || !existing.recipe_suggestion_id) return null;

  const foodEntry = await dietRecipeService.logRecipeSuggestion(userId, existing.recipe_suggestion_id, { consumedAt });
  if (!foodEntry) return null;

  await pool.query('UPDATE diet_schedule_entries SET food_entry_id = $1, updated_at = now() WHERE id = $2', [
    foodEntry.id,
    entryId,
  ]);

  const { rows } = await pool.query('SELECT canonical_recipe_id FROM recipe_suggestions WHERE id = $1', [
    existing.recipe_suggestion_id,
  ]);
  await recipeCatalogService.recordLogged(rows[0]?.canonical_recipe_id);

  return foodEntry;
}

async function deleteSchedule(userId, scheduleId) {
  const { rows } = await pool.query('DELETE FROM diet_schedules WHERE id = $1 AND user_id = $2 RETURNING id', [
    scheduleId,
    userId,
  ]);
  return rows.length > 0;
}

module.exports = {
  DURATIONS,
  MEAL_TYPES,
  createManualSchedule,
  listSchedules,
  getScheduleWithEntries,
  fetchOwnedEntry,
  fetchOwnedEntryWithRecipe,
  updateEntry,
  retryEntryRecipe,
  logScheduleEntry,
  deleteSchedule,
  // Reused by scheduleImportService.js/scheduleGenerationService.js to build
  // entries the same validated way manual creation does.
  addDays,
  insertEntries,
};
