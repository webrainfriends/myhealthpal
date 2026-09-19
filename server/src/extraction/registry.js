const pool = require('../db/pool');

function unitKey(unit) {
  return String(unit || '').trim().toLowerCase().replace(/\s+/g, '');
}

// Returns every health_parameter whose code, display name, or a registered
// alias matches `rawName` (case/whitespace-insensitive, exact match). Zero
// results means "unmapped"; more than one means "ambiguous" — callers must
// not guess between them.
async function findCanonicalMatches(rawName) {
  const normalized = String(rawName || '').trim().toLowerCase();
  if (!normalized) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT hp.*
     FROM health_parameters hp
     LEFT JOIN parameter_aliases pa ON pa.health_parameter_id = hp.id
     WHERE lower(hp.code) = $1
        OR lower(hp.display_name) = $1
        OR lower(pa.alias_text) = $1`,
    [normalized]
  );
  return rows;
}

async function getParameterById(id) {
  if (!id) return null;
  const { rows } = await pool.query('SELECT * FROM health_parameters WHERE id = $1', [id]);
  return rows[0] || null;
}

async function searchParameters(query, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM health_parameters
     WHERE $1 = '' OR display_name ILIKE '%' || $1 || '%' OR code ILIKE '%' || $1 || '%'
     ORDER BY display_name ASC
     LIMIT $2`,
    [String(query || '').trim(), limit]
  );
  return rows;
}

// Converts `rawValue` in `rawUnit` to the parameter's canonical unit using a
// registered conversion rule. Returns null (no safe conversion) rather than
// guessing when the unit already matches, is unknown, or has no rule.
async function convertToCanonicalUnit(parameter, rawValue, rawUnit) {
  if (!parameter || rawValue === null || rawValue === undefined) return null;
  if (!parameter.canonical_unit || !rawUnit) return null;

  if (unitKey(rawUnit) === unitKey(parameter.canonical_unit)) {
    return { normalizedValue: rawValue, normalizedUnit: parameter.canonical_unit };
  }

  const { rows } = await pool.query(
    `SELECT * FROM unit_conversions WHERE health_parameter_id = $1 AND to_unit = $2`,
    [parameter.id, parameter.canonical_unit]
  );
  const conversion = rows.find((row) => unitKey(row.from_unit) === unitKey(rawUnit));
  if (!conversion) return null;

  return {
    normalizedValue: rawValue * conversion.factor + conversion.offset_value,
    normalizedUnit: parameter.canonical_unit,
  };
}

module.exports = { findCanonicalMatches, getParameterById, searchParameters, convertToCanonicalUnit };
