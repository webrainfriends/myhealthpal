const pool = require('../db/pool');
const { getAdapter } = require('../adapters');
const { loadFileBuffer } = require('../security/secureUpload');
const { withTimeout } = require('../lib/withTimeout');
const { logError } = require('../lib/safeLog');
const config = require('../config');
const provider = require('../extraction/providers/insuranceExtractionProvider');

// Turns an uploaded insurance document (PDF / DOCX / photo, any format the
// report pipeline reads) into an insurance_policies row plus its organ-wise
// insurance_coverage_items - the insurance analog of
// dietSchedule/scheduleImportService.js. Always ends in 'Needs Review': the
// person checks what was read and confirms before it drives coverage tags,
// gaps and reminders (a misread exclusion must never silently tell someone
// they are covered).

function enqueueInsuranceProcessing(policyId) {
  setImmediate(() => {
    processInsurancePolicy(policyId).catch((err) => logError(`Unhandled error processing insurance policy ${policyId}`, err));
  });
}

// An extraction that found neither a single coverage clause nor any policy
// identifier is almost certainly not an insurance document (or unreadable).
function looksEmpty({ policy, items }) {
  const hasIdentity = Boolean(policy.providerName || policy.policyNumber || policy.planName);
  return items.length === 0 && !hasIdentity;
}

async function processInsurancePolicy(policyId) {
  const { rows } = await pool.query('SELECT * FROM insurance_policies WHERE id = $1', [policyId]);
  const record = rows[0];
  if (!record) return;

  await pool.query(
    `UPDATE insurance_policies SET ingestion_status = 'Processing', processing_error = NULL, updated_at = now() WHERE id = $1`,
    [policyId]
  );

  try {
    const adapter = getAdapter(record.file_extension);
    if (!adapter) throw new Error(`No ingestion adapter registered for .${record.file_extension} files`);

    // Decrypted into memory only while processing - never written to disk.
    const fileBuffer = await loadFileBuffer(record, { purpose: 'insurance_import', resourceType: 'insurance_policy' });
    const document = await withTimeout(adapter.extract(fileBuffer), config.security.parserTimeoutMs, 'Reading the insurance document');
    const result = await provider.extract(document, { fileBuffer, userId: record.user_id, mimeType: record.mime_type });

    if (looksEmpty(result)) {
      await pool.query(
        `UPDATE insurance_policies SET ingestion_status = 'Failed', processing_error = $2, raw_model_output = $3, updated_at = now() WHERE id = $1`,
        [
          policyId,
          result.warnings.join(' ') || 'No insurance policy details could be read from this document.',
          result.rawModelOutput ? JSON.stringify(result.rawModelOutput) : null,
        ]
      );
      return;
    }

    await saveExtraction(policyId, result);
  } catch (err) {
    const message =
      err.code === 'ai_consent_required'
        ? 'AI document reading is turned off for this profile. Turn on "AI document processing" in Settings → Privacy & AI, then retry.'
        : err.message;
    await pool.query(
      `UPDATE insurance_policies SET ingestion_status = 'Failed', processing_error = $2, updated_at = now() WHERE id = $1`,
      [policyId, message]
    );
  }
}

async function saveExtraction(policyId, { policy, items, warnings, rawModelOutput }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A retry replaces the previous attempt's clauses wholesale.
    await client.query('DELETE FROM insurance_coverage_items WHERE policy_id = $1', [policyId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO insurance_coverage_items
           (policy_id, organ_key, condition_name, coverage_status, ceiling_amount, ceiling_basis, copay_percent, copay_amount,
            deductible_amount, waiting_period_months, sub_limit_note, clause_reference, clause_text, confidence, needs_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          policyId, item.organKey, item.conditionName, item.coverageStatus, item.ceilingAmount, item.ceilingBasis,
          item.copayPercent, item.copayAmount, item.deductibleAmount, item.waitingPeriodMonths, item.subLimitNote,
          item.clauseReference, item.clauseText, item.confidence, item.needsReview,
        ]
      );
    }
    await client.query(
      `UPDATE insurance_policies SET
         provider_name = $2, plan_name = $3, policy_number = $4, policy_type = $5, policyholder_name = $6,
         insured_members = $7, sum_insured = $8, currency = $9, policy_start_date = $10, policy_end_date = $11,
         initial_waiting_days = $12, preexisting_waiting_months = $13, premium_amount = $14, premium_frequency = $15,
         next_premium_due_date = $16, grace_period_days = $17, provider_phone = $18, provider_email = $19,
         provider_website = $20, claims_phone = $21, claims_email = $22, agent_name = $23, agent_phone = $24,
         agent_email = $25, support_phone = $26, support_email = $27, tpa_name = $28, tpa_phone = $29,
         other_contacts = $30, summary = $31, raw_model_output = $32,
         renews_annually = $34, ingestion_status = 'Needs Review', processing_error = $33, updated_at = now()
       WHERE id = $1`,
      [
        policyId, policy.providerName, policy.planName, policy.policyNumber, policy.policyType, policy.policyholderName,
        policy.insuredMembers, policy.sumInsured, policy.currency, policy.policyStartDate, policy.policyEndDate,
        policy.initialWaitingDays, policy.preexistingWaitingMonths, policy.premiumAmount, policy.premiumFrequency,
        policy.nextPremiumDueDate, policy.gracePeriodDays, policy.providerPhone, policy.providerEmail,
        policy.providerWebsite, policy.claimsPhone, policy.claimsEmail, policy.agentName, policy.agentPhone,
        policy.agentEmail, policy.supportPhone, policy.supportEmail, policy.tpaName, policy.tpaPhone,
        policy.otherContacts.length ? JSON.stringify(policy.otherContacts) : null, policy.summary,
        rawModelOutput ? JSON.stringify(rawModelOutput) : null,
        // Non-fatal notes (a truncated document, ...) ride along in the same
        // column a failure would use, so the review screen can show them.
        warnings.length ? warnings.join(' ') : null,
        policy.renewsAnnually,
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { enqueueInsuranceProcessing, processInsurancePolicy, saveExtraction, looksEmpty };
