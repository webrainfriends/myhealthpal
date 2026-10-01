const healthProfileService = require('../../services/healthProfileService');
const retestService = require('../../retest/retestService');
const insightActions = require('../../services/insightActionService');
const { dismissAlert } = require('../../medications/medicationAlertService');
const { setWeightGoal } = require('../../services/weightGoalService');
const kitchenService = require('../../kitchen/kitchenService');
const { ServiceError } = require('../../lib/serviceError');
const { writeTool } = require('./helpers');

// Changes to existing records and settings (scope health:write). Nothing here
// deletes data - removals need an explicit confirmation step (removal.js).

const snoozeRetest = writeTool({
  name: 'snooze_retest',
  description: 'Push a Retest Radar reminder out by 1-60 days.',
  scope: 'health:write',
  properties: { planId: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 60, description: 'Defaults to 7.' } },
  required: ['planId'],
  async execute(args, { userId }) {
    return { data: { plan: await retestService.snoozePlan(userId, args.planId, args.days ?? 7) }, evidence: [{ type: 'retest_plan', id: args.planId }] };
  },
});

const dismissRetest = writeTool({
  name: 'dismiss_retest',
  description: 'Dismiss a Retest Radar plan the person no longer wants to be reminded about.',
  scope: 'health:write',
  properties: { planId: { type: 'string' } },
  required: ['planId'],
  idempotent: true,
  async execute(args, { userId }) {
    return { data: { plan: await retestService.dismissPlan(userId, args.planId) }, evidence: [{ type: 'retest_plan', id: args.planId }] };
  },
});

const dismissInsight = writeTool({
  name: 'dismiss_insight',
  description: 'Dismiss an insight so it stops showing (it can reappear if the underlying results change).',
  scope: 'health:write',
  properties: { insightId: { type: 'string' } },
  required: ['insightId'],
  idempotent: true,
  async execute(args, { userId }) {
    const insight = await insightActions.dismissInsight(userId, args.insightId);
    return { data: { insight: { id: insight.id, lifecycleState: insight.lifecycle_state } }, evidence: [{ type: 'insight', id: insight.id }] };
  },
});

const rateInsight = writeTool({
  name: 'rate_insight',
  description: 'Record whether an insight was useful or not useful.',
  scope: 'health:write',
  properties: { insightId: { type: 'string' }, feedback: { type: 'string', enum: ['useful', 'not_useful'] } },
  required: ['insightId', 'feedback'],
  idempotent: true,
  async execute(args, { userId }) {
    const insight = await insightActions.setInsightFeedback(userId, args.insightId, args.feedback);
    return { data: { insight: { id: insight.id, userFeedback: insight.user_feedback } }, evidence: [{ type: 'insight', id: insight.id }] };
  },
});

const dismissMedicationAlert = writeTool({
  name: 'dismiss_medication_alert',
  description: 'Dismiss a medication alert (expiring, refill needed, course ending).',
  scope: 'health:write',
  properties: { alertId: { type: 'string' } },
  required: ['alertId'],
  idempotent: true,
  async execute(args, { userId }) {
    const alert = await dismissAlert(userId, args.alertId);
    return { data: { alert: { id: alert.id, lifecycleState: alert.lifecycle_state } }, evidence: [{ type: 'medication', id: alert.medication_id }] };
  },
});

const addAllergy = writeTool({
  name: 'add_allergy',
  description: 'Add an allergy (e.g. "peanuts", "penicillin") to the health profile.',
  scope: 'health:write',
  properties: { allergen: { type: 'string' } },
  required: ['allergen'],
  async execute(args, { userId }) {
    return { data: await healthProfileService.addAllergy(userId, args.allergen), evidence: [] };
  },
});

const setWeightGoalTool = writeTool({
  name: 'set_weight_goal',
  description: 'Set or replace the weight goal. Omitted fields are cleared, so pass all three you want kept.',
  scope: 'health:write',
  properties: {
    currentWeightKg: { type: 'number', minimum: 1, maximum: 500 },
    targetWeightKg: { type: 'number', minimum: 1, maximum: 500 },
    targetDate: { type: 'string', description: 'YYYY-MM-DD' },
  },
  idempotent: true,
  async execute(args, { userId }) {
    return { data: await setWeightGoal(userId, args), evidence: [] };
  },
});

const upsertKitchenItem = writeTool({
  name: 'upsert_kitchen_item',
  description: 'Add an item to the kitchen/pantry list, or update it if the name already exists.',
  scope: 'health:write',
  properties: {
    name: { type: 'string' },
    category: { type: 'string', enum: kitchenService.CATEGORIES },
    quantityAmount: { type: 'number', minimum: 0 },
    quantityUnit: { type: 'string', enum: kitchenService.QUANTITY_UNITS },
    isAvailable: { type: 'boolean' },
  },
  required: ['name', 'category'],
  idempotent: true,
  async execute(args, { userId }) {
    if (!args.name || !String(args.name).trim()) throw new ServiceError(400, 'name is required.');
    if (!kitchenService.isValidCategory(args.category)) throw new ServiceError(400, `category must be one of ${kitchenService.CATEGORIES.join(', ')}.`);
    if (!kitchenService.isValidQuantityUnit(args.quantityUnit ?? null)) {
      throw new ServiceError(400, `quantityUnit must be one of ${kitchenService.QUANTITY_UNITS.join(', ')}.`);
    }
    const item = await kitchenService.upsertKitchenItem(userId, {
      name: args.name,
      category: args.category,
      quantityAmount: args.quantityAmount ?? null,
      quantityUnit: args.quantityUnit ?? null,
      isAvailable: args.isAvailable ?? null,
    });
    return { data: { item }, evidence: [] };
  },
});

module.exports = [snoozeRetest, dismissRetest, dismissInsight, rateInsight, dismissMedicationAlert, addAllergy, setWeightGoalTool, upsertKitchenItem];
