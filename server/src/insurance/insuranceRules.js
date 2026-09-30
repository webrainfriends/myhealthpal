const { ORGAN_GROUPS, evaluateResult } = require('../services/organHealthService');

// Pure rules behind "My Insurance": the organ taxonomy policies are read
// into, how a lab result is matched to coverage clauses, premium/renewal
// dates, and the coverage gaps a new abnormal finding raises. No database or
// network here (the same split as retest/retestRules.js), so every rule is
// unit-testable. Nothing in this file interprets a policy's legal meaning -
// it only re-presents what the document itself says, and every message it
// produces points the person back to their insurer for the final word.

// Insurance organ taxonomy. `labGroups` are the dashboard organ-card keys
// (organHealthService.ORGAN_GROUPS) whose lab results bear on this organ's
// cover; organs with none (eye, dental, maternity, ...) can still hold
// clauses but no lab result is ever tagged against them (brain and bones
// included: no blood test measures them - see insuranceOrgansForParameter).
const INSURANCE_ORGANS = [
  { key: 'heart', label: 'Heart & circulation', icon: '❤️', labGroups: ['heart'] },
  { key: 'diabetes', label: 'Diabetes', icon: '💉', labGroups: ['diabetes'] },
  { key: 'kidney', label: 'Kidney & urinary', icon: '🫘', labGroups: ['kidney'] },
  { key: 'liver_pancreas', label: 'Liver & pancreas', icon: '🔥', labGroups: ['liver_pancreas'] },
  { key: 'blood', label: 'Blood', icon: '🩸', labGroups: ['blood'] },
  { key: 'thyroid_endocrine', label: 'Thyroid & hormones', icon: '⚗️', labGroups: ['metabolism', 'hormones'] },
  { key: 'brain_nerves', label: 'Brain & nerves', icon: '🧠', labGroups: [] },
  { key: 'bones_joints', label: 'Bones & joints', icon: '🦴', labGroups: [] },
  { key: 'cancer', label: 'Cancer', icon: '🎗️', labGroups: ['tumor_markers'] },
  { key: 'infections', label: 'Infections & immunity', icon: '🛡️', labGroups: ['immunity'] },
  { key: 'digestive', label: 'Digestive system', icon: '🍽️', labGroups: [] },
  { key: 'respiratory', label: 'Lungs & breathing', icon: '🫁', labGroups: [] },
  { key: 'eye', label: 'Eyes', icon: '👁️', labGroups: [] },
  { key: 'ent', label: 'Ear, nose & throat', icon: '👂', labGroups: [] },
  { key: 'skin', label: 'Skin', icon: '🧴', labGroups: [] },
  { key: 'reproductive_maternity', label: 'Reproductive & maternity', icon: '🤰', labGroups: [] },
  { key: 'mental_health', label: 'Mental health', icon: '🧘', labGroups: [] },
  { key: 'dental', label: 'Dental', icon: '🦷', labGroups: [] },
  { key: 'general', label: 'General / whole policy', icon: '📄', labGroups: [] },
];

const ORGAN_BY_KEY = new Map(INSURANCE_ORGANS.map((organ) => [organ.key, organ]));
const ORGAN_KEYS = INSURANCE_ORGANS.map((organ) => organ.key);
const COVERAGE_STATUSES = ['covered', 'partial', 'excluded'];
const PREMIUM_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'annual', 'single'];
const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };

function organLabel(key) {
  return ORGAN_BY_KEY.get(key)?.label || 'General / whole policy';
}

// Anything the reader model (or a user edit) sends that isn't a known organ
// key lands on 'general' rather than being dropped, so no clause is lost.
function normalizeOrganKey(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s&/-]+/g, '_');
  return ORGAN_BY_KEY.has(key) ? key : 'general';
}

// Dashboard organ-card key -> the insurance organ keys it bears on.
const ORGANS_BY_LAB_GROUP = new Map();
for (const organ of INSURANCE_ORGANS) {
  for (const group of organ.labGroups) {
    ORGANS_BY_LAB_GROUP.set(group, [...(ORGANS_BY_LAB_GROUP.get(group) || []), organ.key]);
  }
}

// The insurance organs a registry parameter bears on: the dashboard organ
// cards its *category* belongs to, mapped through labGroups. Tests a card
// only claims by code as soft relevance (vitamin D and B12 on the Brain and
// Bones cards, HbA1c on Brain, ...) are deliberately not matched: a low
// vitamin D is no evidence of a brain or bone condition, and treating it as
// one would raise coverage gaps for illnesses the person has no finding for.
function insuranceOrgansForParameter({ category }) {
  const organs = new Set();
  for (const group of ORGAN_GROUPS) {
    if (!category || !group.categories.includes(category)) continue;
    for (const key of ORGANS_BY_LAB_GROUP.get(group.key) || []) organs.add(key);
  }
  return [...organs];
}

// ---- Dates ---------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function todayUtc(today = new Date()) {
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

function daysUntil(value, today = new Date()) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.round((d.getTime() - todayUtc(today)) / MS_PER_DAY);
}

// Calendar-month addition that clamps to the last day of a shorter month
// (31 Jan + 1 month = 28/29 Feb, not 3 March).
function addMonths(value, months) {
  const d = parseDate(value);
  if (!d) return null;
  const targetMonth = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDateString(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay))));
}

// ---- Policy period & premium ---------------------------------------------

// Where "today" sits inside the policy's cover period.
function policyPeriod(policy, today = new Date()) {
  const start = parseDate(policy.policy_start_date);
  const end = parseDate(policy.policy_end_date);
  const daysToEnd = daysUntil(policy.policy_end_date, today);
  const daysToStart = daysUntil(policy.policy_start_date, today);
  let state = 'unknown';
  if (end && daysToEnd < 0) state = 'expired';
  else if (start && daysToStart > 0) state = 'upcoming';
  else if (end || start) state = 'active';

  let elapsedPercent = null;
  if (start && end && end > start) {
    elapsedPercent = Math.min(100, Math.max(0, Math.round(((todayUtc(today) - start.getTime()) / (end.getTime() - start.getTime())) * 100)));
  }
  return { state, daysToEnd, daysToStart, elapsedPercent };
}

// The next premium instalment. A due date printed on the document that has
// since passed is rolled forward by the payment frequency (assuming earlier
// instalments were paid) and flagged `estimated`; with no printed date, the
// first instalment after the start date is used the same way. A single-
// premium policy has nothing further to pay once its date has passed.
function nextPremiumDue(policy, today = new Date()) {
  const frequency = policy.premium_frequency;
  const step = FREQUENCY_MONTHS[frequency];
  let due = policy.next_premium_due_date ? String(policy.next_premium_due_date).slice(0, 10) : null;
  let estimated = false;

  if (!due && step && policy.policy_start_date) {
    due = String(policy.policy_start_date).slice(0, 10);
    estimated = true;
  }
  if (!due) return null;

  const endDays = daysUntil(policy.policy_end_date, today);
  let days = daysUntil(due, today);
  if (days === null) return null;

  if (days < 0) {
    if (!step) return frequency === 'single' ? null : { dueDate: due, daysLeft: days, overdue: true, estimated };
    // The printed date is on or before "today"; step forward to the first
    // instalment still ahead. Bounded so a bad date can't loop.
    let guard = 0;
    while (days < 0 && guard < 600) {
      due = addMonths(due, step);
      days = daysUntil(due, today);
      guard += 1;
    }
    estimated = true;
  }
  if (policy.policy_end_date && endDays !== null && endDays >= 0 && days > endDays) return null;
  return { dueDate: due, daysLeft: days, overdue: days < 0, estimated };
}

// ---- Organ coverage summaries --------------------------------------------

function itemWaitingUntil(policy, item) {
  if (!item.waiting_period_months || !policy.policy_start_date) return null;
  return addMonths(policy.policy_start_date, Number(item.waiting_period_months));
}

// One policy's stance on one organ: the clauses that cover it, the ones that
// exclude it, and the headline status - 'covered', 'partial' (mixed, or
// covered with restrictions) or 'not_covered' (only exclusions). Null when
// the policy has no clause on this organ.
function summarizePolicyOrgan(policy, organKey, today = new Date()) {
  const items = (policy.items || []).filter((item) => item.organ_key === organKey);
  if (items.length === 0) return null;

  const covering = items.filter((item) => item.coverage_status !== 'excluded');
  const excluded = items.filter((item) => item.coverage_status === 'excluded');
  let status = 'covered';
  if (covering.length === 0) status = 'not_covered';
  else if (excluded.length > 0 || covering.some((item) => item.coverage_status === 'partial')) status = 'partial';

  const ceilings = covering.map((item) => Number(item.ceiling_amount)).filter((n) => Number.isFinite(n) && n > 0);
  const copays = covering.map((item) => Number(item.copay_percent)).filter((n) => Number.isFinite(n) && n > 0);
  const waitingDates = covering.map((item) => itemWaitingUntil(policy, item));
  // "In waiting" only when every covering clause is still inside its wait.
  const inWaiting =
    covering.length > 0 && waitingDates.every((date) => date && daysUntil(date, today) > 0);
  const waitingUntil = inWaiting ? waitingDates.sort().slice(0, 1)[0] : null;

  return {
    policyId: policy.id,
    policyName: policyLabel(policy),
    status,
    items,
    coveredConditions: covering.map((item) => item.condition_name),
    excludedConditions: excluded.map((item) => item.condition_name),
    maxCeiling: ceilings.length ? Math.max(...ceilings) : null,
    maxCopayPercent: copays.length ? Math.max(...copays) : null,
    currency: policy.currency || null,
    inWaiting,
    waitingUntil,
  };
}

function policyLabel(policy) {
  return [policy.provider_name, policy.plan_name].filter(Boolean).join(' – ') || policy.original_filename || 'Policy';
}

const OVERALL_RANK = { covered: 0, partial: 1, not_covered: 2, not_mentioned: 3 };

// Every confirmed policy's stance on one organ, plus the combined verdict:
// covered if any policy covers it outright, else partial, else not covered
// if only exclusions exist, else not mentioned. Several policies can all be
// tagged on the same organ - each shows separately.
function coverageForOrgan(policies, organKey, today = new Date()) {
  const entries = policies.map((policy) => summarizePolicyOrgan(policy, organKey, today)).filter(Boolean);
  let overall = 'not_mentioned';
  for (const entry of entries) {
    if (OVERALL_RANK[entry.status] < OVERALL_RANK[overall]) overall = entry.status;
  }
  return { organKey, label: organLabel(organKey), icon: ORGAN_BY_KEY.get(organKey)?.icon || '📄', overall, entries };
}

// Tags for one lab parameter: the coverage of every organ it bears on. A
// parameter that bears on no organ (vitamins, say) gets no tag at all
// rather than a misleading "not covered".
function tagParameter(param, policies, today = new Date()) {
  const organKeys = insuranceOrgansForParameter(param);
  if (organKeys.length === 0 || policies.length === 0) return null;
  const organs = organKeys.map((key) => coverageForOrgan(policies, key, today));
  let overall = 'not_mentioned';
  for (const organ of organs) {
    if (OVERALL_RANK[organ.overall] < OVERALL_RANK[overall]) overall = organ.overall;
  }
  return { code: param.code, displayName: param.displayName, overall, organs };
}

// ---- Coverage gaps ----------------------------------------------------------

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const LOW_CEILING_SHARE = 0.25;
const HIGH_COPAY_PERCENT = 20;

function questionsFor(type, organ) {
  const what = organ.toLowerCase();
  switch (type) {
    case 'excluded':
      return [
        `Can the ${what} exclusion be lifted, or covered through a rider or top-up?`,
        'Would this recent finding count as pre-existing if I upgrade or port my plan?',
        `Is there another plan of yours that covers ${what} conditions?`,
      ];
    case 'not_mentioned':
      return [
        `Are ${what} conditions covered under my policy, and is there a sub-limit?`,
        'Are the tests and monitoring visits for this covered (OPD / day-care)?',
        `Which rider or add-on would cover ${what} care?`,
      ];
    case 'waiting_period':
      return [
        `When does cover for ${what} conditions actually start?`,
        'Are diagnostic tests covered while the waiting period runs?',
      ];
    case 'low_ceiling':
      return [
        `Can the ${what} sub-limit be raised, or a top-up added?`,
        'What is the cost of a higher limit at my next renewal?',
      ];
    default:
      return [
        `How much of a ${what} claim would I pay myself (co-pay)?`,
        'Is there an option to reduce or remove the co-pay?',
      ];
  }
}

function gapText(type, organ, entryDetail) {
  switch (type) {
    case 'excluded':
      return {
        title: `${organ}: excluded by your policy`,
        message: `Your latest results include ${organ.toLowerCase()} findings, but ${entryDetail || 'your policy'} lists ${organ.toLowerCase()} conditions as excluded.`,
      };
    case 'not_mentioned':
      return {
        title: `${organ}: not mentioned in your policy`,
        message: `Your latest results include ${organ.toLowerCase()} findings, but none of your policies mention ${organ.toLowerCase()} cover.`,
      };
    case 'waiting_period':
      return {
        title: `${organ}: cover has not started yet`,
        message: `${organ} cover is still in its waiting period${entryDetail ? ` (until ${entryDetail})` : ''}, and your latest results include ${organ.toLowerCase()} findings.`,
      };
    case 'low_ceiling':
      return {
        title: `${organ}: low limit`,
        message: `Your ${organ.toLowerCase()} cover is capped at ${entryDetail}, a small share of your sum insured, and your latest results include ${organ.toLowerCase()} findings.`,
      };
    default:
      return {
        title: `${organ}: you share the cost`,
        message: `${organ} claims carry a ${entryDetail}% co-pay, and your latest results include ${organ.toLowerCase()} findings.`,
      };
  }
}

function formatAmount(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `${currency ? `${currency} ` : ''}${n.toLocaleString('en-IN')}`;
}

function contactFor(policy) {
  if (!policy) return null;
  const name = policy.agent_name || policy.provider_name || null;
  const phone = policy.agent_phone || policy.support_phone || policy.provider_phone || null;
  const email = policy.agent_email || policy.support_email || policy.provider_email || null;
  if (!name && !phone && !email) return null;
  return { role: policy.agent_name ? 'agent' : 'insurer', name, phone, email, policyName: policyLabel(policy) };
}

function draftMessage(gap, contact) {
  const names = gap.parameters
    .map((p) => `${p.displayName}${p.direction ? ` (${p.direction})` : ''}`)
    .join(', ');
  const greeting = contact?.name ? `Hello ${contact.name},` : 'Hello,';
  return [
    greeting,
    '',
    `My latest lab report shows ${names || `${gap.organLabel.toLowerCase()} findings`}. I would like to understand how my insurance treats ${gap.organLabel.toLowerCase()} conditions.`,
    '',
    ...gap.suggestedQuestions.map((q) => `• ${q}`),
    '',
    'Could we discuss this? Thank you.',
  ].join('\n');
}

// Coverage gaps raised by out-of-range results. `abnormal` is the person's
// latest confirmed abnormal parameters, each { code, displayName, category,
// direction, severity }. Returns one gap per organ, most urgent first. Only
// meaningful with at least one confirmed policy - with none there is nothing
// to compare against, so the caller shows an "add your policy" prompt.
function computeCoverageGaps({ policies, abnormal, today = new Date() }) {
  if (!policies.length) return [];

  const byOrgan = new Map();
  for (const param of abnormal) {
    for (const organKey of insuranceOrgansForParameter(param)) {
      if (!byOrgan.has(organKey)) byOrgan.set(organKey, []);
      byOrgan.get(organKey).push(param);
    }
  }

  const gaps = [];
  for (const [organKey, params] of byOrgan) {
    const organ = organLabel(organKey);
    const coverage = coverageForOrgan(policies, organKey, today);
    const worst = params.some((p) => p.severity === 'critical' || p.severity === 'marked') ? 'marked' : 'mild';
    const parameters = params.map((p) => ({ code: p.code, displayName: p.displayName, direction: p.direction || null, severity: p.severity || null }));

    let type = null;
    let severity = 'medium';
    let detail = null;
    let policyRefs = [];

    if (coverage.overall === 'not_mentioned') {
      type = 'not_mentioned';
      severity = worst === 'marked' ? 'high' : 'medium';
      policyRefs = policies;
    } else if (coverage.overall === 'not_covered') {
      type = 'excluded';
      severity = 'high';
      policyRefs = coverage.entries.map((entry) => policies.find((p) => p.id === entry.policyId)).filter(Boolean);
      detail = policyRefs.length === 1 ? policyLabel(policyRefs[0]) : 'your policies';
    } else {
      const covering = coverage.entries.filter((entry) => entry.status !== 'not_covered');
      if (covering.length > 0 && covering.every((entry) => entry.inWaiting)) {
        type = 'waiting_period';
        severity = 'medium';
        detail = covering.map((entry) => entry.waitingUntil).sort()[0];
        policyRefs = covering.map((entry) => policies.find((p) => p.id === entry.policyId)).filter(Boolean);
      } else {
        // Best available cover: judge the ceiling / co-pay of the entry with
        // the highest limit, since that is what the person would rely on.
        const best = [...covering].sort((a, b) => (b.maxCeiling || 0) - (a.maxCeiling || 0))[0];
        const policy = policies.find((p) => p.id === best.policyId);
        const sumInsured = Number(policy?.sum_insured);
        if (best.maxCeiling && Number.isFinite(sumInsured) && sumInsured > 0 && best.maxCeiling < sumInsured * LOW_CEILING_SHARE) {
          type = 'low_ceiling';
          severity = worst === 'marked' ? 'medium' : 'low';
          detail = formatAmount(best.maxCeiling, best.currency);
          policyRefs = [policy];
        } else if (best.maxCopayPercent && best.maxCopayPercent >= HIGH_COPAY_PERCENT) {
          type = 'high_copay';
          severity = 'low';
          detail = String(best.maxCopayPercent);
          policyRefs = [policy];
        }
      }
    }
    if (!type) continue;

    const text = gapText(type, organ, detail);
    const contactPolicy = policyRefs.find((p) => contactFor(p)) || policies.find((p) => contactFor(p));
    const contact = contactFor(contactPolicy);
    const gap = {
      id: `${organKey}:${type}`,
      organKey,
      organLabel: organ,
      icon: ORGAN_BY_KEY.get(organKey)?.icon || '📄',
      type,
      severity,
      title: text.title,
      message: text.message,
      parameters,
      policyNames: policyRefs.map(policyLabel),
      suggestedQuestions: questionsFor(type, organ),
      contact,
    };
    gap.draftMessage = draftMessage(gap, contact);
    gaps.push(gap);
  }

  gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.organLabel.localeCompare(b.organLabel));
  return gaps;
}

// The rows of the person's latest confirmed results that are out of range,
// judged exactly as the dashboard's organ cards judge them.
function abnormalParameters(rows, standardRangesByCode = new Map()) {
  const out = [];
  for (const row of rows) {
    const evaluation = evaluateResult(row, standardRangesByCode.get(row.code));
    if (evaluation.status !== 'abnormal') continue;
    out.push({
      code: row.code,
      displayName: row.displayName,
      category: row.category,
      direction: evaluation.direction,
      severity: evaluation.severity,
    });
  }
  return out;
}

// ---- Reminders -----------------------------------------------------------

// What (if anything) a policy warrants today. `alreadySent` is a Set of
// `${policyId}:${kind}:${period}`. Pure, so the schedule is testable.
function pendingInsuranceReminders(policies, alreadySent, today = new Date()) {
  const pending = [];
  for (const policy of policies) {
    const premium = nextPremiumDue(policy, today);
    if (premium) {
      const kind = premium.daysLeft <= 0 ? 'premium_due' : premium.daysLeft <= 14 ? 'premium_14d' : null;
      if (kind && !alreadySent.has(`${policy.id}:${kind}:${premium.dueDate}`)) {
        pending.push({ policy, kind, period: premium.dueDate, daysLeft: premium.daysLeft, amount: policy.premium_amount });
      }
    }
    const endDays = daysUntil(policy.policy_end_date, today);
    if (endDays !== null && endDays >= 0) {
      const kind = endDays <= 7 ? 'renewal_7d' : endDays <= 30 ? 'renewal_30d' : null;
      const period = String(policy.policy_end_date).slice(0, 10);
      if (kind && !alreadySent.has(`${policy.id}:${kind}:${period}`)) {
        pending.push({ policy, kind, period, daysLeft: endDays });
      }
    }
  }
  const priority = { premium_due: 0, renewal_7d: 1, premium_14d: 2, renewal_30d: 3 };
  pending.sort((a, b) => priority[a.kind] - priority[b.kind] || a.daysLeft - b.daysLeft);
  return pending;
}

module.exports = {
  INSURANCE_ORGANS,
  ORGAN_KEYS,
  COVERAGE_STATUSES,
  PREMIUM_FREQUENCIES,
  organLabel,
  normalizeOrganKey,
  insuranceOrgansForParameter,
  daysUntil,
  addMonths,
  policyPeriod,
  nextPremiumDue,
  policyLabel,
  summarizePolicyOrgan,
  coverageForOrgan,
  tagParameter,
  computeCoverageGaps,
  abnormalParameters,
  pendingInsuranceReminders,
  contactFor,
  HIGH_COPAY_PERCENT,
  LOW_CEILING_SHARE,
};
