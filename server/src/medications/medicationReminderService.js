const pool = require('../db/pool');
const rules = require('./medicationReminderRules');
const { ServiceError } = require('../lib/serviceError');

const LOOKBACK_DAYS = 3;

function todayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Clients pass their own local date; fall back to the server's UTC date.
function resolveDate(input) {
  return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : todayString();
}

async function loadLogsByMedication(medicationIds) {
  const byMedication = new Map(medicationIds.map((id) => [id, []]));
  if (medicationIds.length === 0) return byMedication;
  const { rows } = await pool.query(
    `SELECT * FROM medication_dose_logs WHERE medication_id = ANY($1::uuid[]) ORDER BY scheduled_date, logged_at`,
    [medicationIds]
  );
  for (const row of rows) byMedication.get(row.medication_id).push(row);
  return byMedication;
}

// Reminders (today's doses + supply left + missed) for a set of medications.
async function remindersFor(medications, todayStr) {
  const logs = await loadLogsByMedication(medications.map((m) => m.id));
  return medications.map((medication) => {
    const medLogs = logs.get(medication.id);
    return {
      ...rules.buildReminder(medication, medLogs, todayStr),
      missedRecent: rules.countMissed(medication, medLogs, todayStr, LOOKBACK_DAYS),
    };
  });
}

async function remindersForUser(userId, todayStr) {
  const { rows } = await pool.query(
    `SELECT * FROM medications WHERE user_id = $1 AND is_confirmed = true AND status = 'active' ORDER BY name`,
    [userId]
  );
  return remindersFor(rows, todayStr);
}

// Idempotent per (medication, date, slot): logging again changes the status.
async function logDose(medication, { slot, status, date, loggedBy }) {
  const { rows } = await pool.query(
    `INSERT INTO medication_dose_logs (medication_id, user_id, scheduled_date, slot, status, logged_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (medication_id, scheduled_date, slot)
     DO UPDATE SET status = EXCLUDED.status, logged_by = EXCLUDED.logged_by, logged_at = now()
     RETURNING *`,
    [medication.id, medication.user_id, date, slot, status, loggedBy || null]
  );
  return rows[0];
}

async function undoDose(medication, { slot, date }) {
  await pool.query(
    `DELETE FROM medication_dose_logs WHERE medication_id = $1 AND scheduled_date = $2 AND slot = $3`,
    [medication.id, date, slot]
  );
}

// Records (or undoes) one dose for a medication the user owns, enforcing the
// same rules wherever it is called from (REST route, MCP tool): the slot must
// be one of the medication's scheduled times, and an expired or used-up
// medicine can't be marked taken. `loggedBy` is the signed-in account, which
// may be a caregiver acting for a managed profile.
async function recordDose(userId, medicationId, { slot, status, date: dateInput }, loggedBy) {
  const { rows } = await pool.query('SELECT * FROM medications WHERE id = $1 AND user_id = $2', [medicationId, userId]);
  const medication = rows[0];
  if (!medication) throw new ServiceError(404, 'Medication not found');

  const date = resolveDate(dateInput);
  if (!['taken', 'skipped', 'undo'].includes(status)) {
    throw new ServiceError(400, "status must be 'taken', 'skipped' or 'undo'.");
  }
  if (!rules.isValidSlot(medication, slot)) {
    throw new ServiceError(400, "slot is not one of this medication's scheduled times.");
  }

  if (status === 'undo') {
    await undoDose(medication, { slot, date });
  } else {
    const [before] = await remindersFor([medication], date);
    const alreadyTaken = before.doses.some((d) => d.slot === slot && d.status === 'taken');
    if (status === 'taken' && !alreadyTaken) {
      if (before.stopReason === 'expired') {
        throw new ServiceError(409, `${medication.name} has expired - do not take it.`);
      }
      if (before.dosesRemaining !== null && before.dosesRemaining <= 0) {
        throw new ServiceError(409, `No doses of ${medication.name} are left.`);
      }
    }
    await logDose(medication, { slot, status, date, loggedBy: loggedBy || userId });
  }

  const [reminder] = await remindersFor([medication], date);
  return reminder;
}

module.exports = { resolveDate, remindersFor, remindersForUser, logDose, undoDose, loadLogsByMedication, recordDose };
