const pool = require('../db/pool');

// Different lab vendors print the exact same unit slightly differently -
// "gm/dL" vs "g/dL" is the same mass unit, not a conversion; normalizing it
// here means it matches for every parameter, not just ones someone thought
// to add a factor=1 conversion row for.
function unitKey(unit) {
  return String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^gms?\//, 'g/');
}

// Specimen types a lab commonly appends after a comma - "Creatinine,
// Serum", "Albumin, Serum" - decoration, not part of the test's clinical
// identity (unlike, say, a urine-vs-serum test that's genuinely a
// different clinical measurement and gets its own registry entry instead).
const SPECIMEN_SUFFIX = /,\s*(serum|plasma|urine|whole\s+blood|blood)\s*$/i;

// A printed test name very often carries method/abbreviation decoration
// the source itself supplies - "Haemoglobin (HB)", "Aspartate
// aminotransferase(AST/SGOT)", "GLUCOSE FASTING (FBS)", "Total Leucocytes
// (WBC) Count", "Creatinine, Serum" - where a parenthesized abbreviation
// (wherever it falls in the string, not just at the end), one of its
// "/"-separated parts, the string with it removed, or a trailing specimen-
// type suffix removed, names the exact same test as clearly as the full
// name does. Trying those alongside the untouched raw name is still exact
// matching against registered aliases, never a guess between different
// plausible tests - the document itself is stating each of these strings
// refers to the same result.
function addParenVariants(str, candidates) {
  candidates.add(str.toLowerCase());

  const specimenMatch = str.match(SPECIMEN_SUFFIX);
  if (specimenMatch) {
    const withoutSpecimen = str.slice(0, specimenMatch.index).trim();
    if (withoutSpecimen) candidates.add(withoutSpecimen.toLowerCase());
  }

  const parenGroups = [...str.matchAll(/\(([^()]*)\)/g)];
  if (parenGroups.length === 0) return;

  for (const match of parenGroups) {
    const inside = match[1].trim();
    if (!inside) continue;
    candidates.add(inside.toLowerCase());
    for (const part of inside.split('/')) {
      const trimmedPart = part.trim();
      if (trimmedPart) candidates.add(trimmedPart.toLowerCase());
    }
  }
  // The name with every parenthesized group stripped out, whitespace
  // collapsed - e.g. "Total Leucocytes (WBC) Count" -> "Total Leucocytes
  // Count", "Haemoglobin (HB)" -> "Haemoglobin".
  const withoutParens = str.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutParens) candidates.add(withoutParens.toLowerCase());
}

function candidateNamesFor(rawName) {
  const original = String(rawName || '').trim();
  if (!original) return [];

  const candidates = new Set();
  addParenVariants(original, candidates);

  // A trailing "-MethodName" suffix (e.g. "TSH (...)-Ultra") is assay/
  // vendor decoration, not part of the test's identity - try the parens
  // logic again with it removed too.
  const withoutMethodSuffix = original.replace(/-[A-Za-z]+$/, '').trim();
  if (withoutMethodSuffix && withoutMethodSuffix !== original) {
    addParenVariants(withoutMethodSuffix, candidates);
  }

  return [...candidates];
}

// Returns every health_parameter whose code, display name, or a registered
// alias exactly matches `rawName` or one of its common decorated forms (see
// candidateNamesFor). Zero results means "unmapped"; more than one *distinct*
// parameter means "ambiguous" — callers must not guess between them.
async function findCanonicalMatches(rawName) {
  const candidates = candidateNamesFor(rawName);
  if (candidates.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT DISTINCT hp.*
     FROM health_parameters hp
     LEFT JOIN parameter_aliases pa ON pa.health_parameter_id = hp.id
     WHERE lower(hp.code) = ANY($1)
        OR lower(hp.display_name) = ANY($1)
        OR lower(pa.alias_text) = ANY($1)`,
    [candidates]
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
