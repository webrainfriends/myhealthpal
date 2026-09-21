const pool = require('../db/pool');

const VALUE_EPSILON = 1e-6;

// Looks for a prior measurement — for the same user, same canonical
// parameter, same calendar day, same value — from a different report. This
// is the "same report re-uploaded" / "same result imported twice" case. It
// only ever returns a candidate to flag; nothing is deleted or silently
// merged.
//
// A candidate's "day" is its own sample_datetime when the extractor found
// one on the line/row itself, else its report's effective_date - most
// real-world lab PDFs print a result as a bare "Name Value Unit Range" line
// with no per-line date, so sample_datetime is null far more often than
// not; without this fallback, dedup would almost never fire in practice.
// A measurement already known to be redundant ('confirmed_duplicate') is
// never matched against — always point at a live record, not a copy of one.
async function findDuplicate({ userId, reportId, parameterId, day, numericValue, normalizedValue, qualitativeValue }) {
  if (!parameterId || !day) return null;

  const { rows } = await pool.query(
    `SELECT hm.*
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     WHERE r.user_id = $1
       AND hm.report_id != $2
       AND hm.health_parameter_id = $3
       AND hm.duplicate_status != 'confirmed_duplicate'
       AND COALESCE(hm.sample_datetime::date, r.effective_date) = $4::date`,
    [userId, reportId, parameterId, day]
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

// Re-checks this report's own measurements that couldn't be judged during
// extraction (findDuplicate had no day to check them against yet - the
// common case, since a report's effective_date is only detected *after*
// extraction runs) now that the report's effective_date is known. Never
// deletes or overwrites an existing flag; only ever moves a 'none' forward.
async function reconcileMeasurementDuplicatesForReport({ userId, reportId, effectiveDate }) {
  if (!effectiveDate) return 0;

  const { rows: ownMeasurements } = await pool.query(
    `SELECT id, health_parameter_id, sample_datetime, numeric_value, normalized_value, qualitative_value
     FROM health_measurements
     WHERE report_id = $1 AND duplicate_status = 'none' AND health_parameter_id IS NOT NULL`,
    [reportId]
  );

  let flagged = 0;
  for (const measurement of ownMeasurements) {
    const day = measurement.sample_datetime
      ? new Date(measurement.sample_datetime).toISOString().slice(0, 10)
      : effectiveDate;
    // eslint-disable-next-line no-await-in-loop
    const duplicate = await findDuplicate({
      userId,
      reportId,
      parameterId: measurement.health_parameter_id,
      day,
      numericValue: measurement.numeric_value,
      normalizedValue: measurement.normalized_value,
      qualitativeValue: measurement.qualitative_value,
    });
    if (duplicate) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `UPDATE health_measurements SET duplicate_status = 'suspected', duplicate_of_id = $2, updated_at = now() WHERE id = $1`,
        [measurement.id, duplicate.id]
      );
      flagged += 1;
    }
  }
  return flagged;
}

module.exports = { findDuplicate, reconcileMeasurementDuplicatesForReport };
