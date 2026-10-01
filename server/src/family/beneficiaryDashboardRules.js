const { evaluateMedicationAlerts } = require('../medications/medicationAlertRules');
const { evaluateResult } = require('../services/organHealthService');

// Pure rules behind the sponsor / caretaker beneficiary dashboard: how one
// person's tests, cover, medications and lab results are boiled down to a
// glanceable card and an attention level. No database here (same split as
// retest/retestRules.js), so every rule is unit-testable.

const TEST_DUE_SOON_DAYS = 14;
const PREMIUM_SOON_DAYS = 30;
const RENEWAL_SOON_DAYS = 90;
const MAX_OUT_OF_RANGE = 8;
const SEVERITY_RANK = { critical: 0, marked: 1, mild: 2 };

// Attention levels, worst first: a sponsor scanning several cards should see
// the person who needs something done before the ones who are fine.
const ATTENTION_ORDER = ['urgent', 'attention', 'ok'];

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Retest Radar plans -> "tests due". daysLeft < 0 is overdue.
function summarizeTestsDue(plans) {
  const items = plans.map((plan) => ({
    id: plan.id,
    parameterCode: plan.parameterCode,
    testName: plan.parameterDisplayName,
    dueDate: dateOnly(plan.dueDate),
    daysLeft: plan.daysLeft,
    overdue: plan.daysLeft < 0,
    dueSoon: plan.daysLeft >= 0 && plan.daysLeft <= TEST_DUE_SOON_DAYS,
    flag: plan.flag,
    reason: plan.reason,
  }));
  return {
    items,
    overdueCount: items.filter((i) => i.overdue).length,
    dueSoonCount: items.filter((i) => i.dueSoon).length,
  };
}

function frequencyLabel(medication) {
  const perDay = medication.frequency_per_day === null || medication.frequency_per_day === undefined
    ? null
    : Number(medication.frequency_per_day);
  if (!perDay) return null;
  return perDay === 1 ? 'once a day' : `${perDay} times a day`;
}

// The adherence view a sponsor/caretaker gets of one medication's reminders.
function summarizeReminder(reminder) {
  if (!reminder) return null;
  return {
    active: reminder.active,
    stopReason: reminder.stopReason,
    dueToday: reminder.dueCount,
    takenToday: reminder.takenCount,
    missedRecent: reminder.missedRecent,
    dosesRemaining: reminder.dosesRemaining,
    daysOfSupplyLeft: reminder.daysOfSupplyLeft,
    lastTakenAt: reminder.lastTakenAt,
  };
}

// Active, confirmed medications with their daily reminder schedule, plus the
// deterministic alerts (refill / expiry / course) computed fresh against
// today - read-only, so viewing a dashboard never changes the person's own
// alert lifecycle (dismissals etc.).
function summarizeMedications(medications, today = new Date(), reminders = new Map()) {
  const items = medications.map((medication) => {
    const alerts = evaluateMedicationAlerts(medication, today).map((alert) => ({
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      dueDate: dateOnly(alert.dueDate),
    }));
    return {
      id: medication.id,
      name: medication.name,
      dosageAmount: medication.dosage_amount === null || medication.dosage_amount === undefined ? null : Number(medication.dosage_amount),
      dosageUnit: medication.dosage_unit || null,
      frequency: frequencyLabel(medication),
      timesOfDay: medication.times_of_day || [],
      expiryDate: dateOnly(medication.expiry_date),
      endDate: dateOnly(medication.end_date),
      reminder: summarizeReminder(reminders.get(medication.id)),
      refillSoon: alerts.some((a) => a.type === 'refill_needed'),
      expiringSoon: alerts.some((a) => a.type === 'expiring_soon' || a.type === 'expired'),
      alerts,
    };
  });
  return {
    activeCount: items.length,
    refillSoonCount: items.filter((m) => m.refillSoon).length,
    expiringSoonCount: items.filter((m) => m.expiringSoon).length,
    dosesDueToday: items.reduce((n, m) => n + (m.reminder ? m.reminder.dueToday : 0), 0),
    dosesTakenToday: items.reduce((n, m) => n + (m.reminder ? m.reminder.takenToday : 0), 0),
    missedDoseCount: items.reduce((n, m) => n + (m.reminder ? m.reminder.missedRecent : 0), 0),
    // Medications needing action first.
    items: items.sort(
      (a, b) => b.alerts.length - a.alerts.length || String(a.name).localeCompare(String(b.name))
    ),
  };
}

// Latest result per parameter -> the out-of-range ones, worst first, judged
// exactly as the person's own dashboard cards judge them (evaluateResult).
function summarizeLabResults(results, standardRangesByCode = new Map()) {
  let evaluatedCount = 0;
  const outOfRange = [];
  for (const row of results) {
    const evaluation = evaluateResult(row, standardRangesByCode.get(row.code));
    if (evaluation.status === 'unknown') continue;
    evaluatedCount += 1;
    if (evaluation.status !== 'abnormal') continue;
    outOfRange.push({
      code: row.code,
      name: row.displayName,
      category: row.category,
      value: row.qualitativeValue || row.rawValue,
      unit: row.rawUnit || null,
      direction: evaluation.direction,
      severity: evaluation.severity,
      referenceRange: row.referenceRangeRaw || null,
      date: dateOnly(row.effectiveDate),
    });
  }
  outOfRange.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || String(a.name).localeCompare(String(b.name))
  );
  const latestDate = results.map((r) => dateOnly(r.effectiveDate)).filter(Boolean).sort().pop() || null;
  return {
    evaluatedCount,
    outOfRangeCount: outOfRange.length,
    criticalCount: outOfRange.filter((r) => r.severity === 'critical').length,
    markedCount: outOfRange.filter((r) => r.severity === 'marked').length,
    latestResultDate: latestDate,
    outOfRange: outOfRange.slice(0, MAX_OUT_OF_RANGE),
  };
}

// Headline figures from an insurance overview (see insuranceService).
function summarizeInsurance(overview, summary) {
  const dates = overview.upcoming || [];
  return {
    activePolicyCount: summary.policyCount,
    needsReviewCount: summary.needsReviewCount,
    providerNames: summary.providerNames,
    policies: overview.policies
      .filter((p) => overview.activePolicyIds.includes(p.id))
      .map((p) => ({
        id: p.id,
        label: p.label,
        providerName: p.providerName,
        policyType: p.policyType,
        sumInsured: p.sumInsured,
        currency: p.currency,
      })),
    // Premiums falling due within 30 days and renewals within 90 days (or
    // already overdue) - a sponsor needs longer notice to arrange a renewal.
    upcoming: dates.filter((d) => d.overdue || d.daysLeft <= (d.kind === 'renewal' ? RENEWAL_SOON_DAYS : PREMIUM_SOON_DAYS)),
    renewalCount: dates.filter((d) => d.kind === 'renewal' && (d.overdue || d.daysLeft <= RENEWAL_SOON_DAYS)).length,
    nextPremium: summary.nextPremium,
    nextRenewal: summary.nextRenewal,
    gapCount: summary.gapCount,
    gaps: (overview.gaps || []).slice(0, 5).map((g) => ({ title: g.title, severity: g.severity })),
  };
}

// One attention level per person from the four sections.
function attentionLevel({ testsDue, medications, health, insurance }) {
  const urgent =
    health.criticalCount > 0 ||
    testsDue.overdueCount > 0 ||
    insurance.upcoming.some((d) => d.overdue) ||
    medications.items.some((m) => m.alerts.some((a) => a.severity === 'important'));
  if (urgent) return 'urgent';
  const attention =
    health.outOfRangeCount > 0 ||
    testsDue.dueSoonCount > 0 ||
    medications.refillSoonCount > 0 ||
    medications.missedDoseCount > 0 ||
    medications.expiringSoonCount > 0 ||
    insurance.upcoming.length > 0 ||
    insurance.gapCount > 0 ||
    insurance.needsReviewCount > 0;
  return attention ? 'attention' : 'ok';
}

function buildBeneficiaryCard(member, { testsDue, medications, health, insurance }) {
  return {
    id: member.id,
    displayName: member.displayName,
    relation: member.relation,
    role: member.role,
    isManaged: member.isManaged,
    attention: attentionLevel({ testsDue, medications, health, insurance }),
    testsDue,
    medications,
    health,
    insurance,
  };
}

function sortCards(cards) {
  return [...cards].sort(
    (a, b) =>
      ATTENTION_ORDER.indexOf(a.attention) - ATTENTION_ORDER.indexOf(b.attention) ||
      String(a.displayName || '').localeCompare(String(b.displayName || ''))
  );
}

function buildTotals(cards) {
  const sum = (fn) => cards.reduce((total, card) => total + fn(card), 0);
  return {
    beneficiaryCount: cards.length,
    needingAttention: cards.filter((c) => c.attention !== 'ok').length,
    urgentCount: cards.filter((c) => c.attention === 'urgent').length,
    testsOverdue: sum((c) => c.testsDue.overdueCount),
    testsDueSoon: sum((c) => c.testsDue.dueSoonCount),
    activePolicies: sum((c) => c.insurance.activePolicyCount),
    renewalsWithin90Days: sum((c) => c.insurance.renewalCount || 0),
    upcomingInsuranceDates: sum((c) => c.insurance.upcoming.length),
    refillsSoon: sum((c) => c.medications.refillSoonCount),
    missedDoses: sum((c) => c.medications.missedDoseCount || 0),
    medicationsExpiringSoon: sum((c) => c.medications.expiringSoonCount),
    outOfRangeResults: sum((c) => c.health.outOfRangeCount),
  };
}

module.exports = {
  TEST_DUE_SOON_DAYS,
  PREMIUM_SOON_DAYS,
  RENEWAL_SOON_DAYS,
  summarizeTestsDue,
  summarizeMedications,
  summarizeLabResults,
  summarizeInsurance,
  attentionLevel,
  buildBeneficiaryCard,
  sortCards,
  buildTotals,
};
