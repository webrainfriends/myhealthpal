const pool = require('../db/pool');
const { evaluateMedicationAlerts } = require('./medicationAlertRules');

function buildDedupKey(medicationId, type) {
  return `${type}:${medicationId}`;
}

// Recomputes this medication's alerts against today's date and persists
// whatever's current. Alerts are pull-model (recomputed on load), so a
// dismissed alert must not silently reappear on the very next load just
// because it's still date-eligible: a dismissed alert is only re-surfaced
// (as a fresh active row) if the underlying situation actually changed
// (severity or due date) since it was dismissed - otherwise the dismissal
// is respected.
async function recomputeAlertsForMedication(medication) {
  const candidates = evaluateMedicationAlerts(medication);
  const candidateTypes = new Set(candidates.map((c) => c.type));

  const { rows: existingAlerts } = await pool.query(
    `SELECT DISTINCT ON (alert_type) * FROM medication_alerts
     WHERE medication_id = $1
     ORDER BY alert_type, generated_at DESC`,
    [medication.id]
  );

  for (const alert of existingAlerts) {
    if (alert.lifecycle_state === 'active' && !candidateTypes.has(alert.alert_type)) {
      await pool.query(`UPDATE medication_alerts SET lifecycle_state = 'resolved', updated_at = now() WHERE id = $1`, [
        alert.id,
      ]);
    }
  }

  const publishedIds = [];
  for (const candidate of candidates) {
    const existing = existingAlerts.find((a) => a.alert_type === candidate.type);
    const unchanged =
      existing && existing.severity === candidate.severity && String(existing.due_date ?? '') === String(candidate.dueDate ?? '');

    if (existing && existing.lifecycle_state === 'dismissed' && unchanged) {
      continue; // user already dismissed this exact situation - respect it
    }

    if (existing && existing.lifecycle_state === 'active') {
      await pool.query(
        `UPDATE medication_alerts
         SET severity = $2, title = $3, message = $4, due_date = $5, generated_at = now(), updated_at = now()
         WHERE id = $1`,
        [existing.id, candidate.severity, candidate.title, candidate.message, candidate.dueDate]
      );
      publishedIds.push(existing.id);
      continue;
    }

    const { rows } = await pool.query(
      `INSERT INTO medication_alerts (user_id, medication_id, alert_type, severity, title, message, due_date, dedup_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        medication.user_id,
        medication.id,
        candidate.type,
        candidate.severity,
        candidate.title,
        candidate.message,
        candidate.dueDate,
        buildDedupKey(medication.id, candidate.type),
      ]
    );
    publishedIds.push(rows[0].id);
  }

  return publishedIds;
}

async function recomputeAlertsForUser(userId) {
  const { rows: medications } = await pool.query(
    `SELECT * FROM medications WHERE user_id = $1 AND is_confirmed = true AND status = 'active'`,
    [userId]
  );
  for (const medication of medications) {
    await recomputeAlertsForMedication(medication);
  }
}

module.exports = { recomputeAlertsForMedication, recomputeAlertsForUser };
