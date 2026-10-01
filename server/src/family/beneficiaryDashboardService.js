const pool = require('../db/pool');
const familyService = require('../services/familyService');
const insuranceService = require('../insurance/insuranceService');
const retestService = require('../retest/retestService');
const { getAllReferenceRangesByCode } = require('../medications/referenceRangeService');
const reminderService = require('../medications/medicationReminderService');
const rules = require('./beneficiaryDashboardRules');

async function loadActiveMedications(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM medications WHERE user_id = $1 AND is_confirmed = true AND status = 'active' ORDER BY name`,
    [userId]
  );
  return rows;
}

// A section that fails to load must not blank the whole dashboard (one
// person's odd data shouldn't hide everyone else's) - it comes back as an
// empty section flagged with `error`.
async function safely(label, load, fallback) {
  try {
    return await load();
  } catch (err) {
    console.error(`[beneficiary-dashboard] ${label} failed:`, err.message);
    return { ...fallback, error: true };
  }
}

async function buildCard(member, standardRanges, today) {
  const [testsDue, medications, health, insurance] = await Promise.all([
    safely(
      'tests due',
      async () => {
        await retestService.recomputeForUser(member.id);
        return rules.summarizeTestsDue(await retestService.listVisiblePlans(member.id, today));
      },
      rules.summarizeTestsDue([])
    ),
    safely(
      'medications',
      async () => {
        const medications = await loadActiveMedications(member.id);
        const reminders = await reminderService.remindersFor(medications, today.toISOString().slice(0, 10));
        return rules.summarizeMedications(medications, today, new Map(reminders.map((r) => [r.medicationId, r])));
      },
      rules.summarizeMedications([])
    ),
    safely(
      'lab results',
      async () => rules.summarizeLabResults(await insuranceService.loadLatestResults(member.id), standardRanges),
      rules.summarizeLabResults([])
    ),
    safely(
      'insurance',
      async () => {
        const overview = await insuranceService.buildOverview(member.id, today);
        return rules.summarizeInsurance(overview, insuranceService.summarizeOverview(overview));
      },
      rules.summarizeInsurance(
        { policies: [], activePolicyIds: [], upcoming: [], gaps: [] },
        { policyCount: 0, needsReviewCount: 0, providerNames: [], nextPremium: null, nextRenewal: null, gapCount: 0 }
      )
    ),
  ]);
  return rules.buildBeneficiaryCard(member, { testsDue, medications, health, insurance });
}

// The dashboard for whoever `accountId` sponsors or takes care of. The set
// of people comes solely from family_links rows this account owns
// (familyService.listBeneficiaries) - so it can never include the account
// itself, the people who look after it, or anyone tagged to somebody else.
async function buildDashboard(accountId, today = new Date()) {
  const [members, standardRanges] = await Promise.all([
    familyService.listBeneficiaries(accountId),
    getAllReferenceRangesByCode(),
  ]);
  const cards = rules.sortCards(await Promise.all(members.map((member) => buildCard(member, standardRanges, today))));
  return { generatedAt: today.toISOString(), totals: rules.buildTotals(cards), beneficiaries: cards };
}

module.exports = { buildDashboard };
