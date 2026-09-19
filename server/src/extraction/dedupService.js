const pool = require('../db/pool');

const VALUE_EPSILON = 1e-6;

// Looks for a prior *confirmed* measurement — for the same user, same
// canonical parameter, same calendar day, same value — from a different
// report. This is the "same report re-uploaded" / "same result imported
// twice" case. It only ever returns a candidate to flag; nothing is deleted
// or silently merged.
async function findDuplicate({ userId, reportId, parameterId, sampleDatetime, numericValue, normalizedValue, qualitativeValue }) {
  if (!parameterId || !sampleDatetime) return null;

  const { rows } = await pool.query(
    `SELECT hm.*
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     WHERE r.user_id = $1
       AND hm.report_id != $2
       AND hm.health_parameter_id = $3
       AND hm.is_confirmed = true
       AND date_trunc('day', hm.sample_datetime) = date_trunc('day', $4::timestamptz)`,
    [userId, reportId, parameterId, sampleDatetime]
  );

  const comparisonValue = normalizedValue ?? numericValue;

  for (const candidate of rows) {
    if (qualitativeValue) {
      if (String(candidate.qualitative_value || '').toLowerCase() === String(qualitativeValue).toLowerCase()) {
        return candidate;
      }
      continue;
    }
    if (comparisonValue === null || comparisonValue === undefined) continue;
    const candidateValue = candidate.normalized_value ?? candidate.numeric_value;
    if (candidateValue !== null && Math.abs(candidateValue - comparisonValue) < VALUE_EPSILON) {
      return candidate;
    }
  }

  return null;
}

module.exports = { findDuplicate };
