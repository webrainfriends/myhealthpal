const pool = require('../db/pool');
const { getAllReferenceRangesByCode } = require('../medications/referenceRangeService');
const { evaluateResult } = require('../services/organHealthService');
const rules = require('./insuranceRules');

// Reads and assembles everything the My Insurance screens show: the
// person's policies with their clauses, coverage per organ across all
// policies, every lab result tagged covered / not covered, coverage gaps
// raised by out-of-range results, and upcoming premium / renewal dates.
// Only *confirmed* (Completed) and not-yet-expired policies drive tags,
// gaps and reminders - an unreviewed extraction never tells anyone they are
// covered.

const EXCLUDE_DUPLICATES_SQL = `hm.duplicate_status NOT IN ('suspected', 'confirmed_duplicate')`;

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeItem(item) {
  return {
    id: item.id,
    organKey: item.organ_key,
    organLabel: rules.organLabel(item.organ_key),
    conditionName: item.condition_name,
    coverageStatus: item.coverage_status,
    ceilingAmount: num(item.ceiling_amount),
    ceilingBasis: item.ceiling_basis,
    copayPercent: num(item.copay_percent),
    copayAmount: num(item.copay_amount),
    deductibleAmount: num(item.deductible_amount),
    waitingPeriodMonths: item.waiting_period_months,
    subLimitNote: item.sub_limit_note,
    clauseReference: item.clause_reference,
    clauseText: item.clause_text,
    confidence: num(item.confidence),
    needsReview: item.needs_review,
  };
}

function serializePolicy(row, today = new Date()) {
  const items = (row.items || []).map(serializeItem);
  const period = rules.policyPeriod(row, today);
  return {
    id: row.id,
    originalFilename: row.original_filename,
    ingestionStatus: row.ingestion_status,
    processingError: row.processing_error,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    providerName: row.provider_name,
    planName: row.plan_name,
    label: rules.policyLabel(row),
    policyNumber: row.policy_number,
    policyType: row.policy_type,
    policyholderName: row.policyholder_name,
    insuredMembers: row.insured_members,
    sumInsured: num(row.sum_insured),
    currency: row.currency,
    policyStartDate: row.policy_start_date,
    policyEndDate: row.policy_end_date,
    initialWaitingDays: row.initial_waiting_days,
    preexistingWaitingMonths: row.preexisting_waiting_months,
    premiumAmount: num(row.premium_amount),
    premiumFrequency: row.premium_frequency,
    nextPremiumDueDate: row.next_premium_due_date,
    gracePeriodDays: row.grace_period_days,
    contacts: {
      providerPhone: row.provider_phone,
      providerEmail: row.provider_email,
      providerWebsite: row.provider_website,
      claimsPhone: row.claims_phone,
      claimsEmail: row.claims_email,
      agentName: row.agent_name,
      agentPhone: row.agent_phone,
      agentEmail: row.agent_email,
      supportPhone: row.support_phone,
      supportEmail: row.support_email,
      tpaName: row.tpa_name,
      tpaPhone: row.tpa_phone,
      other: row.other_contacts || [],
    },
    summary: row.summary,
    period,
    nextPremium: rules.nextPremiumDue(row, today),
    items,
  };
}

async function loadPolicies(userId) {
  const { rows: policies } = await pool.query(
    `SELECT * FROM insurance_policies WHERE user_id = $1 ORDER BY (ingestion_status = 'Completed') DESC, created_at DESC`,
    [userId]
  );
  if (policies.length === 0) return [];
  const { rows: items } = await pool.query(
    `SELECT * FROM insurance_coverage_items WHERE policy_id = ANY($1)
     ORDER BY organ_key, (coverage_status = 'excluded'), condition_name`,
    [policies.map((p) => p.id)]
  );
  const byPolicy = new Map();
  for (const item of items) {
    if (!byPolicy.has(item.policy_id)) byPolicy.set(item.policy_id, []);
    byPolicy.get(item.policy_id).push(item);
  }
  return policies.map((p) => ({ ...p, items: byPolicy.get(p.id) || [] }));
}

async function loadOwnedPolicy(userId, policyId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(policyId || ''))) return null;
  const { rows } = await pool.query('SELECT * FROM insurance_policies WHERE id = $1 AND user_id = $2', [policyId, userId]);
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM insurance_coverage_items WHERE policy_id = $1 ORDER BY organ_key, (coverage_status = 'excluded'), condition_name`,
    [policyId]
  );
  return { ...rows[0], items };
}

// The latest confirmed-or-pending result per parameter - the same set the
// dashboard's organ cards read, so a tag always sits next to a result the
// person can see there.
async function loadLatestResults(userId) {
  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT hm.report_id, hm.raw_value, hm.raw_unit, hm.qualitative_value, hm.status_flag,
              hm.reference_range_raw, hm.numeric_value, hm.normalized_value,
              hp.code, hp.display_name, hp.category, r.effective_date,
              row_number() OVER (
                PARTITION BY hm.health_parameter_id
                ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC, hm.created_at DESC
              ) AS rank
       FROM health_measurements hm
       JOIN reports r ON r.id = hm.report_id
       JOIN health_parameters hp ON hp.id = hm.health_parameter_id
       WHERE r.user_id = $1 AND r.ingestion_status IN ('Needs Review', 'Completed') AND ${EXCLUDE_DUPLICATES_SQL}
     )
     SELECT * FROM ranked WHERE rank = 1`,
    [userId]
  );
  return rows.map((row) => ({
    code: row.code,
    displayName: row.display_name,
    category: row.category,
    rawValue: row.raw_value,
    rawUnit: row.raw_unit,
    qualitativeValue: row.qualitative_value,
    statusFlag: row.status_flag,
    referenceRangeRaw: row.reference_range_raw,
    numericValue: row.numeric_value,
    normalizedValue: row.normalized_value,
    effectiveDate: row.effective_date,
    reportId: row.report_id,
  }));
}

function coveringPolicies(policies, today) {
  return policies.filter((p) => p.ingestion_status === 'Completed' && rules.policyPeriod(p, today).state !== 'expired');
}

const STATUS_RANK = { covered: 0, partial: 1, not_covered: 2 };

function serializeEntry(entry) {
  return { ...entry, items: entry.items.map(serializeItem) };
}

function serializeCoverage(coverage) {
  return { ...coverage, entries: coverage.entries.map(serializeEntry) };
}

// One tag per lab result that bears on an organ: the best verdict across
// policies plus each policy's own stance, so a result can carry several
// policies at once. serializePolicy builds the response field by field, so
// no storage / key column can ever leak into it.
function buildTag(result, evaluation, policies, today) {
  const tag = rules.tagParameter(result, policies, today);
  if (!tag) return null;
  const perPolicy = new Map();
  for (const organ of tag.organs) {
    for (const entry of organ.entries) {
      const previous = perPolicy.get(entry.policyId);
      if (!previous || STATUS_RANK[entry.status] < STATUS_RANK[previous.status]) {
        perPolicy.set(entry.policyId, { policyId: entry.policyId, policyName: entry.policyName, status: entry.status, organKey: organ.organKey });
      }
    }
  }
  return {
    code: result.code,
    displayName: result.displayName,
    value: result.qualitativeValue || result.rawValue,
    unit: result.rawUnit || null,
    abnormal: evaluation.status === 'abnormal',
    direction: evaluation.direction,
    severity: evaluation.severity,
    overall: tag.overall,
    organKeys: tag.organs.map((o) => o.organKey),
    policies: [...perPolicy.values()],
  };
}

function upcomingDates(policies, today) {
  const dates = [];
  for (const policy of policies) {
    const premium = rules.nextPremiumDue(policy, today);
    if (premium) {
      dates.push({
        kind: 'premium', policyId: policy.id, policyName: rules.policyLabel(policy), date: premium.dueDate,
        daysLeft: premium.daysLeft, amount: num(policy.premium_amount), currency: policy.currency,
        estimated: premium.estimated, overdue: premium.overdue,
      });
    }
    const endDays = rules.daysUntil(policy.policy_end_date, today);
    if (endDays !== null && endDays >= 0) {
      dates.push({
        kind: 'renewal', policyId: policy.id, policyName: rules.policyLabel(policy),
        date: String(policy.policy_end_date).slice(0, 10), daysLeft: endDays, amount: null, currency: null, estimated: false, overdue: false,
      });
    }
  }
  return dates.sort((a, b) => a.daysLeft - b.daysLeft);
}

async function buildOverview(userId, today = new Date()) {
  const [allPolicies, results, standardRanges] = await Promise.all([
    loadPolicies(userId),
    loadLatestResults(userId),
    getAllReferenceRangesByCode(),
  ]);
  const active = coveringPolicies(allPolicies, today);

  const evaluated = results.map((row) => ({ row, evaluation: evaluateResult(row, standardRanges.get(row.code)) }));
  const abnormal = rules.abnormalParameters(results, standardRanges);

  const tags = [];
  for (const { row, evaluation } of evaluated) {
    const tag = buildTag(row, evaluation, active, today);
    if (tag) tags.push(tag);
  }
  tags.sort(
    (a, b) =>
      Number(b.abnormal) - Number(a.abnormal) ||
      String(a.overall).localeCompare(String(b.overall)) ||
      a.displayName.localeCompare(b.displayName)
  );

  // Organs with any clause in an active policy, plus any organ an abnormal
  // result bears on (so a "not mentioned" organ is still listed).
  const organKeys = new Set();
  for (const policy of active) for (const item of policy.items) organKeys.add(item.organ_key);
  for (const param of abnormal) for (const key of rules.insuranceOrgansForParameter(param)) organKeys.add(key);
  const abnormalOrgans = new Set(abnormal.flatMap((param) => rules.insuranceOrgansForParameter(param)));
  const organCoverage = rules.INSURANCE_ORGANS.filter((organ) => organKeys.has(organ.key)).map((organ) => ({
    ...serializeCoverage(rules.coverageForOrgan(active, organ.key, today)),
    hasAbnormalResults: abnormalOrgans.has(organ.key),
  }));

  const gaps = rules.computeCoverageGaps({ policies: active, abnormal, today });

  return {
    policies: allPolicies.map((policy) => serializePolicy(policy, today)),
    activePolicyIds: active.map((p) => p.id),
    organCoverage,
    tags,
    gaps,
    upcoming: upcomingDates(active, today),
    organs: rules.INSURANCE_ORGANS.map(({ key, label, icon }) => ({ key, label, icon })),
  };
}

async function buildSummary(userId, today = new Date()) {
  const overview = await buildOverview(userId, today);
  const policies = overview.policies;
  const active = policies.filter((p) => overview.activePolicyIds.includes(p.id));
  const nextPremium = overview.upcoming.find((d) => d.kind === 'premium') || null;
  const nextRenewal = overview.upcoming.find((d) => d.kind === 'renewal') || null;
  return {
    policyCount: active.length,
    totalCount: policies.length,
    needsReviewCount: policies.filter((p) => p.ingestionStatus === 'Needs Review').length,
    processingCount: policies.filter((p) => p.ingestionStatus === 'Processing' || p.ingestionStatus === 'Uploaded').length,
    nextPremium,
    nextRenewal,
    gapCount: overview.gaps.length,
    topGap: overview.gaps[0] ? { title: overview.gaps[0].title, severity: overview.gaps[0].severity } : null,
    providerNames: active.map((p) => p.providerName).filter(Boolean),
  };
}

module.exports = {
  loadPolicies,
  loadOwnedPolicy,
  loadLatestResults,
  coveringPolicies,
  buildOverview,
  buildSummary,
  serializePolicy,
  serializeItem,
  upcomingDates,
};
