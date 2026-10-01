const pool = require('../db/pool');
const { loadOwnedReport } = require('../security/reportAccess');
const { deleteStoredFile } = require('../security/secureUpload');
const insuranceService = require('../insurance/insuranceService');
const audit = require('../security/auditLog');
const { logError } = require('../lib/safeLog');
const { ServiceError } = require('../lib/serviceError');

// Permanent removals, shared by the REST DELETE routes and the MCP connector
// (which wraps each in a confirmation step). A deleted file's key goes with
// its row, so any leftover ciphertext is unreadable.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id, what) {
  if (!UUID_RE.test(String(id))) throw new ServiceError(404, `${what} not found`);
}

async function deleteReport(userId, reportId) {
  assertUuid(reportId, 'Report');
  const report = await loadOwnedReport(userId, reportId, { purpose: 'report_delete' });
  if (!report) throw new ServiceError(404, 'Report not found');

  await pool.query('DELETE FROM reports WHERE id = $1 AND user_id = $2', [report.id, userId]);
  try {
    await deleteStoredFile(report);
  } catch (err) {
    // The key is already gone with the row, so the ciphertext is
    // unreadable; a leftover object is disk space, not exposure.
    logError(`Could not remove stored file for deleted report ${report.id}`, err);
  }
  await audit.record({ eventType: 'REPORT_DELETED', userId: report.user_id, reportId: report.id, purpose: 'user_request' });
}

async function deletePolicy(userId, policyId) {
  assertUuid(policyId, 'Policy');
  const owned = await insuranceService.loadOwnedPolicy(userId, policyId);
  if (!owned) throw new ServiceError(404, 'Policy not found');
  // Coverage items and sent-reminder rows go with it (ON DELETE CASCADE).
  await pool.query('DELETE FROM insurance_policies WHERE id = $1 AND user_id = $2', [owned.id, userId]);
  try {
    await deleteStoredFile(owned);
  } catch (err) {
    logError(`Could not remove stored file for deleted insurance policy ${owned.id}`, err);
  }
  await audit.record({ eventType: 'REPORT_DELETED', userId: owned.user_id, resourceType: 'insurance_policy', purpose: 'user_request' });
}

async function deleteMedication(userId, medicationId) {
  assertUuid(medicationId, 'Medication');
  const { rows } = await pool.query('DELETE FROM medications WHERE id = $1 AND user_id = $2 RETURNING id', [medicationId, userId]);
  if (rows.length === 0) throw new ServiceError(404, 'Medication not found');
}

async function deleteFoodEntry(userId, entryId) {
  assertUuid(entryId, 'Entry');
  const { rows } = await pool.query('DELETE FROM food_entries WHERE id = $1 AND user_id = $2 RETURNING id', [entryId, userId]);
  if (rows.length === 0) throw new ServiceError(404, 'Entry not found');
}

module.exports = { deleteReport, deletePolicy, deleteMedication, deleteFoodEntry, assertUuid };
