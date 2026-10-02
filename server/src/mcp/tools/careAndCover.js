const config = require('../../config');
const { recomputeForUser, listVisiblePlans } = require('../../retest/retestService');
const { bookingFor } = require('../../retest/retestRules');
const insuranceService = require('../../insurance/insuranceService');
const beneficiaryDashboard = require('../../family/beneficiaryDashboardService');
const { readTool, evidence } = require('./helpers');

const listRetestPlans = readTool({
  name: 'list_retest_plans',
  description:
    'Retest Radar: for each out-of-range result (and medicines linked to a lab value), the date to check again by, its status, test-day preparation tips and a booking link for the right panel.',
  async execute(args, { userId }) {
    await recomputeForUser(userId);
    const plans = (await listVisiblePlans(userId)).map((plan) => {
      const booking = bookingFor(config.labBookingUrlTemplate, plan);
      return { ...plan, bookingUrl: booking.url, booking };
    });
    return { data: { plans }, evidence: evidence('retest_plan', plans) };
  },
});

const getInsuranceOverview = readTool({
  name: 'get_insurance_overview',
  description:
    "Health-insurance policies on file with insurer, cover period, premium and renewal dates, and which lab results each policy covers or doesn't (coverage gaps).",
  async execute(args, { userId }) {
    const overview = await insuranceService.buildOverview(userId);
    return { data: overview, evidence: evidence('insurance_policy', overview.policies, 'id', 'planName') };
  },
});

const getInsuranceSummary = readTool({
  name: 'get_insurance_summary',
  description: 'A short insurance summary: number of policies, upcoming premium/renewal dates and coverage gaps raised by out-of-range results.',
  async execute(args, { userId }) {
    return { data: await insuranceService.buildSummary(userId), evidence: [] };
  },
});

const getInsurancePolicy = readTool({
  name: 'get_insurance_policy',
  description: 'Full detail for one insurance policy by id: contacts, premium schedule and organ-wise clauses with ceilings, co-pay and waiting periods.',
  properties: { policyId: { type: 'string' } },
  required: ['policyId'],
  async execute(args, { userId }) {
    const policy = await insuranceService.loadOwnedPolicy(userId, args.policyId);
    if (!policy) return { data: { found: false }, evidence: [] };
    const data = insuranceService.serializePolicy(policy);
    return { data: { found: true, policy: data }, evidence: [{ type: 'insurance_policy', id: policy.id, label: policy.plan_name }] };
  },
});

const getFamilyDashboard = readTool({
  name: 'get_family_dashboard',
  description:
    'Sponsor/caretaker summary of the people this account supports: per-person health status cards, insurance renewals and medicine adherence. Summary only, never full records.',
  scope: 'family:manage',
  accountLevel: true,
  async execute(args, { account }) {
    return { data: await beneficiaryDashboard.buildDashboard(account.id), evidence: [] };
  },
});

module.exports = [listRetestPlans, getInsuranceOverview, getInsuranceSummary, getInsurancePolicy, getFamilyDashboard];
