const pool = require('../db/pool');

// Different lab vendors print the exact same unit slightly differently -
// "gm/dL" vs "g/dL" is the same mass unit, not a conversion; normalizing it
// here means it matches for every parameter, not just ones someone thought
// to add a factor=1 conversion row for.
//
// Same idea for the other spelling variants labs use for one unit: the
// micro sign (µ/μ vs u), "cumm"/"mm3" for a microlitre (1 mm3 = 1 uL), a
// leading "x" or superscript 10^3 on a count unit, and eGFR's "/1.73 m2".
function unitKey(unit) {
  return String(unit || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[µμ]/g, 'u')
    .replace(/³/g, '^3')
    .replace(/⁶/g, '^6')
    .replace(/⁹/g, '^9')
    .replace(/^x(?=10)/, '')
    .replace(/10\*(\d)/, '10^$1')
    .replace(/\/(?:cu\.?mm|cumm|mm\^?3|mm³)$/, '/ul')
    .replace(/(1\.73)(?:m\^?2|m²|m2)$/, '$1')
    .replace(/^gms?\//, 'g/');
}

// Whether a unit printed next to a result could plausibly belong to the
// parameter. Guards against a unit captured from a neighbouring column
// (a differential count's "%" landing on AST/ALT, which are U/L). Only
// answers "no" when it's confident: the parameter has a canonical unit, and
// the raw unit matches neither it nor any registered conversion.
async function isUnitPlausible(parameter, rawUnit) {
  if (!parameter || !rawUnit) return true;
  // A unitless parameter (a ratio, pH, a score) has no unit at all, so any
  // unit captured next to it came from a neighbouring column.
  if (!parameter.canonical_unit) return false;
  const key = unitKey(rawUnit);
  if (key === unitKey(parameter.canonical_unit)) return true;
  const { rows } = await pool.query(
    `SELECT from_unit FROM unit_conversions WHERE health_parameter_id = $1`,
    [parameter.id]
  );
  return rows.some((row) => unitKey(row.from_unit) === key);
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
  // A trailing "." (e.g. "BETA CELL FUNCTION.") is print/formatting
  // decoration from the source, never part of the test's own name.
  const original = String(rawName || '').trim().replace(/\.+$/, '').trim();
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
//
// Names are compared "squashed" (lower-cased, only letters and digits kept) so
// spacing and punctuation variants ("TC/HDL Ratio", "TC / HDL  ratio") match
// the same alias without every variant having to be listed. The full printed
// name is tried first: only when it matches nothing are the parenthesised /
// split-out parts tried, so "AST/ALT Ratio (SGOT/SGPT)" resolves to the ratio
// instead of also matching AST and ALT through its "SGOT" and "SGPT" parts.
function squash(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// A looser, order-insensitive key for telling whether two printed names are
// the same test: "Cholesterol - HDL", "HDL Cholesterol" and "HDL-C
// Cholesterol" share one. Used only to decide whether an older result has
// been replaced by a newer one (never to assign a result to a parameter),
// so it can afford to be a bit looser than registry matching - but it keeps
// every word that changes the test ("total", "direct", "ratio", "%").
const TOKEN_SYNONYMS = {
  tc: 'cholesterol',
  chol: 'cholesterol',
  tg: 'triglyceride',
  tgl: 'triglyceride',
  trig: 'triglyceride',
  leucocyte: 'wbc',
  leukocyte: 'wbc',
  sgot: 'ast',
  sgpt: 'alt',
  hb: 'hemoglobin',
  haemoglobin: 'hemoglobin',
};
const TOKEN_STOPWORDS = new Set(['serum', 'plasma', 'level', 'test', 'estimation', 'value', 'count']);

function tokenKey(text) {
  // A slash between two names ("TC/HDL", "AST/ALT") is a ratio of them; one
  // inside parentheses ("AST (SGOT/SGPT)") is just two names for one test.
  const phrase = String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, (group) => group.replace(/\//g, ' '))
    .replace(/\//g, ' ratio ')
    .replace(/\btotal\s+(leu[ck]ocytes?|wbc)\b/g, 'wbc')
    .replace(/\bt\.?\s*(c|g)\b/g, (m, c) => (c === 'c' ? 'cholesterol' : 'triglyceride'));
  const tokens = phrase
    .split(/[^a-z0-9%]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
    .map((t) => TOKEN_SYNONYMS[t] || t)
    .filter((t) => !TOKEN_STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(' ');
}

// tokenKey -> the parameters (code, display name, aliases) that produce it,
// loaded once so a whole list can be resolved without a query per name.
async function loadTokenIndex() {
  const { rows } = await pool.query(
    `SELECT hp.id, hp.code, hp.display_name, hp.category, hp.canonical_unit, pa.alias_text
     FROM health_parameters hp
     LEFT JOIN parameter_aliases pa ON pa.health_parameter_id = hp.id`
  );
  const byId = new Map();
  const index = new Map();
  const add = (key, parameter) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(parameter.id, parameter);
  };
  for (const row of rows) {
    const parameter = byId.get(row.id) || {
      id: row.id,
      code: row.code,
      display_name: row.display_name,
      category: row.category,
      canonical_unit: row.canonical_unit,
    };
    byId.set(row.id, parameter);
    add(tokenKey(row.code.replace(/_/g, ' ')), parameter);
    add(tokenKey(row.display_name), parameter);
    if (row.alias_text) add(tokenKey(row.alias_text), parameter);
  }
  // A name that several parameters share is ambiguous, not a match.
  return {
    resolve(name) {
      const hits = index.get(tokenKey(name));
      return hits && hits.size === 1 ? [...hits.values()][0] : null;
    },
  };
}

async function matchSquashed(names) {
  const keys = [...new Set(names.map(squash).filter(Boolean))];
  if (keys.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT hp.*
     FROM health_parameters hp
     LEFT JOIN parameter_aliases pa ON pa.health_parameter_id = hp.id
     WHERE regexp_replace(lower(hp.code), '[^a-z0-9]', '', 'g') = ANY($1)
        OR regexp_replace(lower(hp.display_name), '[^a-z0-9]', '', 'g') = ANY($1)
        OR regexp_replace(lower(pa.alias_text), '[^a-z0-9]', '', 'g') = ANY($1)`,
    [keys]
  );
  return rows;
}

async function findCanonicalMatches(rawName) {
  const candidates = candidateNamesFor(rawName);
  if (candidates.length === 0) return [];

  // candidates[0] is the full printed name (decoration like a trailing "."
  // already removed).
  const exact = await matchSquashed([candidates[0]]);
  if (exact.length > 0) return exact;
  return matchSquashed(candidates.slice(1));
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

module.exports = {
  findCanonicalMatches,
  getParameterById,
  searchParameters,
  convertToCanonicalUnit,
  isUnitPlausible,
  squash,
  tokenKey,
  loadTokenIndex,
  unitKey,
};
