const express = require('express');
const pool = require('../db/pool');
const insuranceService = require('../insurance/insuranceService');
const { enqueueInsuranceProcessing } = require('../insurance/insuranceImportService');
const rules = require('../insurance/insuranceRules');
const { deleteStoredFile } = require('../security/secureUpload');
const audit = require('../security/auditLog');
const { logError } = require('../lib/safeLog');

const router = express.Router();

// req.user is set by the requireAuth middleware (app.js) from a verified
// session token - never trust a client-supplied id for this.
function currentUserId(req) {
  return req.user.id;
}

router.get('/', async (req, res, next) => {
  try {
    const overview = await insuranceService.buildOverview(currentUserId(req));
    // Reminders are the signed-in account's setting (it's their phone),
    // even while viewing a family member's policies.
    res.json({ ...overview, remindersEnabled: req.accountUser.insurance_reminders_enabled });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await insuranceService.buildSummary(currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const policy = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json({ policy: insuranceService.serializePolicy(policy) });
  } catch (err) {
    next(err);
  }
});

// ---- Editing what was read --------------------------------------------------

const TEXT_FIELDS = {
  providerName: 'provider_name',
  planName: 'plan_name',
  policyNumber: 'policy_number',
  policyType: 'policy_type',
  policyholderName: 'policyholder_name',
  insuredMembers: 'insured_members',
  currency: 'currency',
  providerPhone: 'provider_phone',
  providerEmail: 'provider_email',
  providerWebsite: 'provider_website',
  claimsPhone: 'claims_phone',
  claimsEmail: 'claims_email',
  agentName: 'agent_name',
  agentPhone: 'agent_phone',
  agentEmail: 'agent_email',
  supportPhone: 'support_phone',
  supportEmail: 'support_email',
  tpaName: 'tpa_name',
  tpaPhone: 'tpa_phone',
  summary: 'summary',
};
const NUMBER_FIELDS = {
  sumInsured: 'sum_insured',
  premiumAmount: 'premium_amount',
};
const INT_FIELDS = {
  initialWaitingDays: 'initial_waiting_days',
  preexistingWaitingMonths: 'preexisting_waiting_months',
  gracePeriodDays: 'grace_period_days',
};
const DATE_FIELDS = {
  policyStartDate: 'policy_start_date',
  policyEndDate: 'policy_end_date',
  nextPremiumDueDate: 'next_premium_due_date',
};

class ValidationError extends Error {}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function parseNumber(value, field, { integer = false } = {}) {
  if (isBlank(value)) return null;
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    throw new ValidationError(`${field} must be a ${integer ? 'whole ' : ''}number of zero or more.`);
  }
  return n;
}

function parseDateField(value, field) {
  if (isBlank(value)) return null;
  const s = String(value).trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD form.`);
  }
  return s;
}

function buildPolicyUpdates(body) {
  const updates = {};
  for (const [key, column] of Object.entries(TEXT_FIELDS)) {
    if (body[key] !== undefined) updates[column] = isBlank(body[key]) ? null : String(body[key]).trim().slice(0, 2000);
  }
  for (const [key, column] of Object.entries(NUMBER_FIELDS)) {
    if (body[key] !== undefined) updates[column] = parseNumber(body[key], key);
  }
  for (const [key, column] of Object.entries(INT_FIELDS)) {
    if (body[key] !== undefined) updates[column] = parseNumber(body[key], key, { integer: true });
  }
  for (const [key, column] of Object.entries(DATE_FIELDS)) {
    if (body[key] !== undefined) updates[column] = parseDateField(body[key], key);
  }
  if (body.premiumFrequency !== undefined) {
    if (!isBlank(body.premiumFrequency) && !rules.PREMIUM_FREQUENCIES.includes(body.premiumFrequency)) {
      throw new ValidationError(`premiumFrequency must be one of: ${rules.PREMIUM_FREQUENCIES.join(', ')}.`);
    }
    updates.premium_frequency = isBlank(body.premiumFrequency) ? null : body.premiumFrequency;
  }
  return updates;
}

function updateSql(updates, startIndex = 2) {
  const columns = Object.keys(updates);
  return {
    assignments: columns.map((column, i) => `${column} = $${startIndex + i}`).join(', '),
    values: columns.map((column) => updates[column]),
  };
}

router.patch('/:id', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });

    const updates = buildPolicyUpdates(req.body || {});
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields were provided.' });
    const { assignments, values } = updateSql(updates);
    await pool.query(`UPDATE insurance_policies SET ${assignments}, updated_at = now() WHERE id = $1`, [owned.id, ...values]);

    const policy = await insuranceService.loadOwnedPolicy(currentUserId(req), owned.id);
    res.json({ policy: insuranceService.serializePolicy(policy) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/confirm', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    if (owned.ingestion_status !== 'Needs Review') {
      return res.status(409).json({ error: `Policy cannot be confirmed from status "${owned.ingestion_status}".` });
    }
    await pool.query(
      `UPDATE insurance_policies SET ingestion_status = 'Completed', confirmed_at = now(), processing_error = NULL, updated_at = now() WHERE id = $1`,
      [owned.id]
    );
    await pool.query('UPDATE insurance_coverage_items SET needs_review = false, updated_at = now() WHERE policy_id = $1', [owned.id]);
    const policy = await insuranceService.loadOwnedPolicy(currentUserId(req), owned.id);
    res.json({ policy: insuranceService.serializePolicy(policy) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/retry', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    if (owned.ingestion_status === 'Processing') return res.status(409).json({ error: 'Policy is already processing.' });
    enqueueInsuranceProcessing(owned.id);
    res.json({ status: 'queued' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    // Coverage items and sent-reminder rows go with it (ON DELETE CASCADE);
    // once the row - and so the wrapped key - is gone the ciphertext can no
    // longer be decrypted, same as a deleted report.
    await pool.query('DELETE FROM insurance_policies WHERE id = $1 AND user_id = $2', [owned.id, currentUserId(req)]);
    try {
      await deleteStoredFile(owned);
    } catch (err) {
      logError(`Could not remove stored file for deleted insurance policy ${owned.id}`, err);
    }
    await audit.record({ eventType: 'REPORT_DELETED', userId: owned.user_id, resourceType: 'insurance_policy', purpose: 'user_request' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---- Coverage clauses -------------------------------------------------------

function buildItemFields(body, { requireAll }) {
  const fields = {};
  if (body.organKey !== undefined || requireAll) {
    fields.organ_key = rules.normalizeOrganKey(body.organKey);
  }
  if (body.conditionName !== undefined || requireAll) {
    if (isBlank(body.conditionName)) throw new ValidationError('conditionName is required.');
    fields.condition_name = String(body.conditionName).trim().slice(0, 300);
  }
  if (body.coverageStatus !== undefined || requireAll) {
    if (!rules.COVERAGE_STATUSES.includes(body.coverageStatus)) {
      throw new ValidationError(`coverageStatus must be one of: ${rules.COVERAGE_STATUSES.join(', ')}.`);
    }
    fields.coverage_status = body.coverageStatus;
  }
  const numeric = { ceilingAmount: 'ceiling_amount', copayPercent: 'copay_percent', copayAmount: 'copay_amount', deductibleAmount: 'deductible_amount' };
  for (const [key, column] of Object.entries(numeric)) {
    if (body[key] !== undefined) fields[column] = parseNumber(body[key], key);
  }
  if (body.copayPercent !== undefined && fields.copay_percent !== null && fields.copay_percent > 100) {
    throw new ValidationError('copayPercent cannot be more than 100.');
  }
  if (body.waitingPeriodMonths !== undefined) fields.waiting_period_months = parseNumber(body.waitingPeriodMonths, 'waitingPeriodMonths', { integer: true });
  for (const [key, column] of Object.entries({ ceilingBasis: 'ceiling_basis', subLimitNote: 'sub_limit_note', clauseReference: 'clause_reference', clauseText: 'clause_text' })) {
    if (body[key] !== undefined) fields[column] = isBlank(body[key]) ? null : String(body[key]).trim().slice(0, key === 'clauseText' ? 2000 : 300);
  }
  return fields;
}

router.post('/:id/items', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    const fields = buildItemFields(req.body || {}, { requireAll: true });
    const columns = ['policy_id', ...Object.keys(fields)];
    const { rows } = await pool.query(
      `INSERT INTO insurance_coverage_items (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      [owned.id, ...Object.values(fields)]
    );
    res.status(201).json({ item: insuranceService.serializeItem(rows[0]) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/items/:itemId', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    const fields = buildItemFields(req.body || {}, { requireAll: false });
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No editable fields were provided.' });
    const { assignments, values } = updateSql(fields, 3);
    const { rows } = await pool.query(
      `UPDATE insurance_coverage_items SET ${assignments}, needs_review = false, updated_at = now()
       WHERE id = $1 AND policy_id = $2 RETURNING *`,
      [req.params.itemId, owned.id, ...values]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Coverage item not found' });
    res.json({ item: insuranceService.serializeItem(rows[0]) });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    // A malformed item id is a client error, not a server fault.
    if (err.code === '22P02') return res.status(404).json({ error: 'Coverage item not found' });
    next(err);
  }
});

router.delete('/:id/items/:itemId', async (req, res, next) => {
  try {
    const owned = await insuranceService.loadOwnedPolicy(currentUserId(req), req.params.id);
    if (!owned) return res.status(404).json({ error: 'Policy not found' });
    const { rowCount } = await pool.query('DELETE FROM insurance_coverage_items WHERE id = $1 AND policy_id = $2', [
      req.params.itemId,
      owned.id,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'Coverage item not found' });
    res.status(204).send();
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Coverage item not found' });
    next(err);
  }
});

module.exports = router;
