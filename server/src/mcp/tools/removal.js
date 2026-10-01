const pool = require('../../db/pool');
const removal = require('../../services/recordRemovalService');
const waterService = require('../../water/waterService');
const kitchenService = require('../../kitchen/kitchenService');
const scheduleService = require('../../dietSchedule/scheduleService');
const workoutService = require('../../services/workoutService');
const confirmation = require('../confirmation');
const { ServiceError } = require('../../lib/serviceError');
const { schema } = require('./helpers');

// Permanent removals. Each is a two-step tool: called with just the target id
// it changes nothing and returns what would be deleted plus a confirmation
// token; called again with that token it deletes. Account deletion and key
// management are deliberately not available here - those stay in the app.

function removeTool({ name, noun, idField, describe, run }) {
  return {
    name,
    description:
      `Permanently delete ${noun}. TWO STEPS: first call with only ${idField} - nothing is deleted yet and you get a summary and a confirmationToken. ` +
      'Show that summary to the user and ask them to confirm; only if they clearly agree, call again with the same id and the confirmationToken. Cannot be undone.',
    inputSchema: schema(
      {
        [idField]: { type: 'string' },
        confirmationToken: { type: 'string', description: 'From the first call. Only send after the user has explicitly confirmed.' },
      },
      [idField]
    ),
    scope: 'health:write',
    accountLevel: false,
    mutates: true,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async execute(args, ctx) {
      const targetId = args[idField];
      removal.assertUuid(targetId, noun);
      const subject = { grantId: ctx.grantId, subjectId: ctx.userId, tool: name, targetId };

      if (!args.confirmationToken) {
        const summary = await describe(ctx.userId, targetId); // throws 404 for anything not theirs
        return {
          data: {
            confirmationRequired: true,
            summary,
            confirmationToken: confirmation.issue(subject),
            expiresInSeconds: confirmation.TTL_SECONDS,
            instruction: 'Nothing has been deleted. Ask the user to confirm, then call again with this confirmationToken.',
          },
          evidence: [],
        };
      }

      confirmation.consume(args.confirmationToken, subject);
      await run(ctx.userId, targetId);
      return { data: { deleted: true }, evidence: [] };
    },
  };
}

async function one(sql, params, notFound) {
  const { rows } = await pool.query(sql, params);
  if (rows.length === 0) throw new ServiceError(404, notFound);
  return rows[0];
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'unknown date');

const deleteReport = removeTool({
  name: 'delete_report',
  noun: 'a health report (the uploaded file and every result extracted from it)',
  idField: 'reportId',
  async describe(userId, id) {
    const r = await one(
      `SELECT r.original_filename, r.effective_date, r.report_type,
              (SELECT count(*)::int FROM health_measurements hm WHERE hm.report_id = r.id) AS results
       FROM reports r WHERE r.id = $1 AND r.user_id = $2`,
      [id, userId],
      'Report not found'
    );
    return `Report "${r.original_filename}" (${r.report_type || 'report'}, ${day(r.effective_date)}) and its ${r.results} extracted results.`;
  },
  run: (userId, id) => removal.deleteReport(userId, id),
});

const deleteInsurancePolicy = removeTool({
  name: 'delete_insurance_policy',
  noun: 'an insurance policy (the uploaded file and its coverage clauses)',
  idField: 'policyId',
  async describe(userId, id) {
    const r = await one(
      `SELECT provider_name, plan_name, original_filename FROM insurance_policies WHERE id = $1 AND user_id = $2`,
      [id, userId],
      'Policy not found'
    );
    return `Insurance policy "${r.plan_name || r.original_filename}" from ${r.provider_name || 'an unnamed insurer'}, with all its coverage clauses.`;
  },
  run: (userId, id) => removal.deletePolicy(userId, id),
});

const deleteMedication = removeTool({
  name: 'delete_medication',
  noun: 'a medicine and its dose history',
  idField: 'medicationId',
  async describe(userId, id) {
    const r = await one('SELECT name FROM medications WHERE id = $1 AND user_id = $2', [id, userId], 'Medication not found');
    return `Medicine "${r.name}" with its dose history, reminders and alerts.`;
  },
  run: (userId, id) => removal.deleteMedication(userId, id),
});

const deleteFoodEntry = removeTool({
  name: 'delete_food_entry',
  noun: 'a logged meal',
  idField: 'entryId',
  async describe(userId, id) {
    const r = await one('SELECT name, calories, consumed_at FROM food_entries WHERE id = $1 AND user_id = $2', [id, userId], 'Entry not found');
    return `Logged meal "${r.name}"${r.calories != null ? ` (${Math.round(r.calories)} kcal)` : ''} from ${day(r.consumed_at)}.`;
  },
  run: (userId, id) => removal.deleteFoodEntry(userId, id),
});

const deleteWaterEntry = removeTool({
  name: 'delete_water_entry',
  noun: 'a logged water entry',
  idField: 'entryId',
  async describe(userId, id) {
    const r = await one('SELECT amount_ml, logged_at FROM water_entries WHERE id = $1 AND user_id = $2', [id, userId], 'Entry not found');
    return `Water entry of ${r.amount_ml} ml from ${day(r.logged_at)}.`;
  },
  async run(userId, id) {
    if (!(await waterService.deleteWaterEntry(userId, id))) throw new ServiceError(404, 'Entry not found');
  },
});

const removeAllergy = removeTool({
  name: 'remove_allergy',
  noun: 'an allergy from the health profile',
  idField: 'allergyId',
  async describe(userId, id) {
    const r = await one('SELECT allergen FROM user_allergies WHERE id = $1 AND user_id = $2', [id, userId], 'Allergy not found');
    return `Allergy "${r.allergen}" - removing it means it will no longer be considered in food and medicine suggestions.`;
  },
  async run(userId, id) {
    await pool.query('DELETE FROM user_allergies WHERE id = $1 AND user_id = $2', [id, userId]);
  },
});

const deleteKitchenItem = removeTool({
  name: 'delete_kitchen_item',
  noun: 'a kitchen/pantry item',
  idField: 'itemId',
  async describe(userId, id) {
    const r = await one('SELECT name FROM kitchen_items WHERE id = $1 AND user_id = $2', [id, userId], 'Item not found');
    return `Kitchen item "${r.name}".`;
  },
  async run(userId, id) {
    if (!(await kitchenService.deleteKitchenItem(userId, id))) throw new ServiceError(404, 'Item not found');
  },
});

const deleteDietSchedule = removeTool({
  name: 'delete_diet_schedule',
  noun: 'a meal plan and all its days',
  idField: 'scheduleId',
  async describe(userId, id) {
    const r = await one('SELECT title, duration_days FROM diet_schedules WHERE id = $1 AND user_id = $2', [id, userId], 'Schedule not found');
    return `Meal plan "${r.title}" (${r.duration_days} days) with all its meals.`;
  },
  async run(userId, id) {
    if (!(await scheduleService.deleteSchedule(userId, id))) throw new ServiceError(404, 'Schedule not found');
  },
});

const deleteWorkoutPlan = removeTool({
  name: 'delete_workout_plan',
  noun: 'a saved workout plan',
  idField: 'planId',
  async describe(userId, id) {
    const r = await one('SELECT name FROM workout_plan WHERE id = $1 AND user_id = $2', [id, userId], 'Workout plan not found');
    return `Workout plan "${r.name}". Past workouts done from it are kept.`;
  },
  run: (userId, id) => workoutService.deletePlan(userId, id),
});

const deleteWorkout = removeTool({
  name: 'delete_workout',
  noun: 'a workout session (including any retained video)',
  idField: 'workoutId',
  async describe(userId, id) {
    const r = await one('SELECT status, started_at, completed_at FROM workout_session WHERE id = $1 AND user_id = $2', [id, userId], 'Workout not found');
    return `Workout session (${r.status}) from ${day(r.completed_at || r.started_at)} with its sets and any retained recording.`;
  },
  async run(userId, id) {
    const { deleted } = await workoutService.deleteSessions(userId, [id]);
    if (!deleted) throw new ServiceError(404, 'Workout not found');
  },
});

module.exports = [
  deleteReport,
  deleteInsurancePolicy,
  deleteMedication,
  deleteFoodEntry,
  deleteWaterEntry,
  removeAllergy,
  deleteKitchenItem,
  deleteDietSchedule,
  deleteWorkoutPlan,
  deleteWorkout,
];
