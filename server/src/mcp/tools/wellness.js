const weightGoalService = require('../../services/weightGoalService');
const waterService = require('../../water/waterService');
const waterTargetService = require('../../water/waterTargetService');
const healthProfileService = require('../../services/healthProfileService');
const kitchenService = require('../../kitchen/kitchenService');
const reminderService = require('../../medications/medicationReminderService');
const consentService = require('../../security/consentService');
const { readTool } = require('./helpers');

const todayKey = () => new Date().toISOString().slice(0, 10);

const getWaterSummary = readTool({
  name: 'get_water_summary',
  description: "Today's (or a given date's) water intake: entries, total in ml, the personal min/ideal/max target and, for today, an under/over-hydration alert.",
  properties: { date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
  async execute(args, { userId }) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date || '') ? args.date : todayKey();
    const [{ entries, totalMl }, target] = await Promise.all([
      waterService.getDaySummary(userId, date),
      waterTargetService.getOrGenerateWaterTarget(userId),
    ]);
    const alert = date === todayKey() ? waterTargetService.evaluateIntake(totalMl, target) : null;
    return { data: { date, entries, totalMl, target, alert }, evidence: [] };
  },
});

const getWaterHistory = readTool({
  name: 'get_water_history',
  description: 'Daily water totals (ml) for the last N days (1-90, default 14) with the current target.',
  properties: { days: { type: 'integer', minimum: 1, maximum: 90 } },
  async execute(args, { userId }) {
    const [days, target] = await Promise.all([
      waterService.getHistory(userId, args.days),
      waterTargetService.getOrGenerateWaterTarget(userId),
    ]);
    return { data: { days, target }, evidence: [] };
  },
});

const getHealthProfile = readTool({
  name: 'get_health_profile',
  description: "The person's height, weight history, BMI and recorded allergies.",
  async execute(args, { userId }) {
    return { data: await healthProfileService.getProfile(userId), evidence: [] };
  },
});

const getWeightGoal = readTool({
  name: 'get_weight_goal',
  description: "The person's weight goal: current weight, target weight and target date.",
  async execute(args, { userId }) {
    return { data: await weightGoalService.getWeightGoal(userId), evidence: [] };
  },
});

const listKitchenItems = readTool({
  name: 'list_kitchen_items',
  description: "Items in the person's kitchen/pantry that recipe and meal suggestions draw on.",
  properties: {
    category: { type: 'string' },
    search: { type: 'string' },
    availableOnly: { type: 'boolean' },
  },
  async execute(args, { userId }) {
    const items = await kitchenService.listKitchenItems(userId, {
      category: args.category || null,
      search: args.search || null,
      availableOnly: args.availableOnly === true,
    });
    return { data: { items }, evidence: [] };
  },
});

const getMedicationReminders = readTool({
  name: 'get_medication_reminders',
  description: "Today's (or a given date's) medicine doses: what is due, taken, skipped, and recently missed.",
  properties: { date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' } },
  async execute(args, { userId }) {
    const date = reminderService.resolveDate(args.date);
    const reminders = await reminderService.remindersForUser(userId, date);
    return {
      data: {
        date,
        reminders,
        totals: {
          due: reminders.reduce((n, r) => n + r.dueCount, 0),
          taken: reminders.reduce((n, r) => n + r.takenCount, 0),
          missedRecent: reminders.reduce((n, r) => n + r.missedRecent, 0),
        },
      },
      evidence: reminders.map((r) => ({ type: 'medication', id: r.medicationId || r.id, label: r.name })).filter((e) => e.id),
    };
  },
});

const getPrivacyConsents = readTool({
  name: 'get_privacy_consents',
  description: "Which privacy choices this person has made (record storage, AI document reading, AI insights, AI apps). Read-only; changes are made in the EyeMyHealth app.",
  async execute(args, { userId }) {
    return { data: { policyVersion: consentService.POLICY_VERSION, consents: await consentService.getConsents(userId) }, evidence: [] };
  },
});

module.exports = [getWaterSummary, getWaterHistory, getHealthProfile, getWeightGoal, listKitchenItems, getMedicationReminders, getPrivacyConsents];
