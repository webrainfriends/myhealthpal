const pool = require('../db/pool');

// Looks up the standards-based (WHO/ICMR/FDA) reference range for a
// parameter - see migrations/008_medications.sql for why this is a
// dedicated table, never a report's own reference_range_raw.
async function getReferenceRange(healthParameterId) {
  const { rows } = await pool.query(
    `SELECT * FROM reference_ranges WHERE health_parameter_id = $1 AND condition_label = 'general' LIMIT 1`,
    [healthParameterId]
  );
  return rows[0] || null;
}

// Bulk form of getReferenceRange, keyed by parameter code rather than id -
// used by organHealthService, which already has each measurement's code
// from its own query and would otherwise need N+1 lookups per organ card.
async function getAllReferenceRangesByCode() {
  const { rows } = await pool.query(
    `SELECT hp.code, rr.range_low, rr.range_high, rr.unit, rr.source
     FROM reference_ranges rr
     JOIN health_parameters hp ON hp.id = rr.health_parameter_id
     WHERE rr.condition_label = 'general'`
  );
  return new Map(rows.map((row) => [row.code, row]));
}

// 'in_range' | 'below_range' | 'above_range' | 'unknown' (no value or no
// standards range on file - excluded from any score rather than guessed).
function scoreAgainstRange(value, range) {
  if (value === null || value === undefined || !range) return { status: 'unknown', inRange: null };
  if (range.range_low !== null && range.range_low !== undefined && value < range.range_low) {
    return { status: 'below_range', inRange: false };
  }
  if (range.range_high !== null && range.range_high !== undefined && value > range.range_high) {
    return { status: 'above_range', inRange: false };
  }
  return { status: 'in_range', inRange: true };
}

module.exports = { getReferenceRange, getAllReferenceRangesByCode, scoreAgainstRange };
