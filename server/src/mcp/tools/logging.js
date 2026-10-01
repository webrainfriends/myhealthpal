const pool = require('../../db/pool');
const waterService = require('../../water/waterService');
const healthProfileService = require('../../services/healthProfileService');
const reminderService = require('../../medications/medicationReminderService');
const retestService = require('../../retest/retestService');
const { logActivity } = require('../../services/activitySummaryService');
const { classifyMealType } = require('../../diet/dietScanService');
const { ServiceError } = require('../../lib/serviceError');
const { writeTool } = require('./helpers');

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

function parseWhen(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ServiceError(400, 'That date/time is not valid. Use ISO 8601, e.g. 2026-10-01T08:30:00Z.');
  return d;
}

function optionalNumber(value, field, { max = 100000 } = {}) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new ServiceError(400, `${field} must be a number between 0 and ${max}.`);
  return n;
}

// Everything here is an everyday "log this" action: small, additive, easy to
// correct in the app. Edits and deletions live in editing.js / removal.js.

const logWater = writeTool({
  name: 'log_water',
  description: 'Log a drink of water in millilitres (e.g. 250 for a glass). Returns the saved entry.',
  properties: {
    amountMl: { type: 'integer', minimum: 1, description: 'Amount in ml.' },
    loggedAt: { type: 'string', description: 'ISO 8601 time. Defaults to now.' },
  },
  required: ['amountMl'],
  async execute(args, { userId }) {
    const entry = await waterService.logWaterEntry(userId, { amountMl: args.amountMl, loggedAt: parseWhen(args.loggedAt) });
    return { data: { entry }, evidence: [{ type: 'water_entry', id: entry.id }] };
  },
});

const logMeal = writeTool({
  name: 'log_meal',
  description:
    'Log something the person ate or drank. Give calories/macros only if the user stated them - do not guess. ' +
    'The meal type is worked out from the time when omitted.',
  properties: {
    name: { type: 'string', description: 'What was eaten, e.g. "2 idlis with sambar".' },
    mealType: { type: 'string', enum: MEAL_TYPES },
    consumedAt: { type: 'string', description: 'ISO 8601 time. Defaults to now.' },
    calories: { type: 'number', minimum: 0 },
    proteinG: { type: 'number', minimum: 0 },
    carbsG: { type: 'number', minimum: 0 },
    fatG: { type: 'number', minimum: 0 },
    notes: { type: 'string' },
  },
  required: ['name'],
  async execute(args, { userId }) {
    const name = typeof args.name === 'string' ? args.name.trim().slice(0, 200) : '';
    if (!name) throw new ServiceError(400, 'name is required.');
    if (args.mealType !== undefined && !MEAL_TYPES.includes(args.mealType)) {
      throw new ServiceError(400, `mealType must be one of ${MEAL_TYPES.join(', ')}.`);
    }
    const consumedAt = parseWhen(args.consumedAt);
    const { rows } = await pool.query(
      `INSERT INTO food_entries (user_id, name, meal_type, consumed_at, calories, protein_g, carbs_g, fat_g, source_type, notes, is_confirmed, ai_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9, true, false) RETURNING *`,
      [
        userId,
        name,
        args.mealType || classifyMealType(consumedAt),
        consumedAt,
        optionalNumber(args.calories, 'calories', { max: 20000 }),
        optionalNumber(args.proteinG, 'proteinG', { max: 2000 }),
        optionalNumber(args.carbsG, 'carbsG', { max: 5000 }),
        optionalNumber(args.fatG, 'fatG', { max: 2000 }),
        typeof args.notes === 'string' ? args.notes.slice(0, 500) : null,
      ]
    );
    return { data: { entry: rows[0] }, evidence: [{ type: 'food_entry', id: rows[0].id, label: name }] };
  },
});

const logMedicationDose = writeTool({
  name: 'log_medication_dose',
  description:
    "Mark one scheduled dose as taken or skipped, or undo it. `slot` is one of the medicine's scheduled times from get_medication_reminders " +
    '(e.g. "morning"). Refuses expired or used-up medicines.',
  properties: {
    medicationId: { type: 'string' },
    slot: { type: 'string' },
    status: { type: 'string', enum: ['taken', 'skipped', 'undo'] },
    date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
  },
  required: ['medicationId', 'slot', 'status'],
  idempotent: true,
  async execute(args, { userId, account }) {
    const reminder = await reminderService.recordDose(
      userId,
      args.medicationId,
      { slot: args.slot, status: args.status, date: args.date },
      account.id
    );
    return { data: { reminder }, evidence: [{ type: 'medication', id: args.medicationId, label: reminder.name }] };
  },
});

const logWeight = writeTool({
  name: 'log_weight',
  description: 'Record a body-weight measurement in kilograms.',
  properties: { weightKg: { type: 'number', minimum: 1, maximum: 500 } },
  required: ['weightKg'],
  async execute(args, { userId }) {
    return { data: await healthProfileService.addWeightEntry(userId, args.weightKg), evidence: [] };
  },
});

const logHeight = writeTool({
  name: 'log_height',
  description: 'Record body height in centimetres.',
  properties: { heightCm: { type: 'number', minimum: 30, maximum: 300 } },
  required: ['heightCm'],
  async execute(args, { userId }) {
    return { data: await healthProfileService.addHeightEntry(userId, args.heightCm), evidence: [] };
  },
});

const logActivityTool = writeTool({
  name: 'log_activity',
  description: "Log a day's steps, exercise minutes and/or stand hours. Fields left out keep whatever was already logged for that day.",
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
    steps: { type: 'integer', minimum: 0 },
    exerciseMinutes: { type: 'integer', minimum: 0 },
    standHours: { type: 'integer', minimum: 0, maximum: 24 },
  },
  idempotent: true,
  async execute(args, { userId }) {
    const data = await logActivity(userId, {
      log_date: args.date,
      steps: args.steps,
      exercise_minutes: args.exerciseMinutes,
      stand_hours: args.standHours,
    });
    return { data, evidence: [] };
  },
});

const retestCheckin = writeTool({
  name: 'retest_checkin',
  description: "Tick (or untick with done=false) this week's small action on a Retest Radar plan. Get plan ids from list_retest_plans.",
  properties: { planId: { type: 'string' }, done: { type: 'boolean', description: 'Defaults to true.' } },
  required: ['planId'],
  idempotent: true,
  async execute(args, { userId }) {
    const plan = await retestService.setCheckin(userId, args.planId, args.done);
    return { data: { plan }, evidence: [{ type: 'retest_plan', id: args.planId }] };
  },
});

module.exports = [logWater, logMeal, logMedicationDose, logWeight, logHeight, logActivityTool, retestCheckin];
