const pool = require('../db/pool');
const registry = require('../extraction/registry');
const KNOWLEDGE_BASE = require('./medicationKnowledgeBase');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Matches a medication's name/generic_name/brand_name against the curated
// knowledge base by plain alias lookup (substring either direction, so
// "Metformin 500mg" matches the "metformin" alias and "Metformin" matches
// a longer registered alias too) - the same kind of exact/decorated-form
// matching extraction/registry.js uses for lab parameter names, never a
// fuzzy/LLM guess between candidates.
function findKnowledgeEntry(medication) {
  const candidates = [medication.generic_name, medication.name, medication.brand_name].map(normalize).filter(Boolean);
  if (candidates.length === 0) return null;

  for (const entry of KNOWLEDGE_BASE) {
    const aliases = [entry.id, ...entry.genericNames, ...entry.brandNames].map(normalize);
    const matched = candidates.some((candidate) =>
      aliases.some((alias) => candidate === alias || candidate.includes(alias) || alias.includes(candidate))
    );
    if (matched) return entry;
  }
  return null;
}

// Re-derives medication_parameter_links for one medication from the
// knowledge base and persists them - called whenever a medication's
// identity (name/generic_name/brand_name) is set: on create, on scan
// confirm, and on any later correction to those fields.
async function syncParameterLinks(medicationId) {
  const { rows } = await pool.query('SELECT * FROM medications WHERE id = $1', [medicationId]);
  const medication = rows[0];
  if (!medication) return [];

  await pool.query('DELETE FROM medication_parameter_links WHERE medication_id = $1', [medicationId]);

  const entry = findKnowledgeEntry(medication);
  if (!entry) return [];

  const linked = [];
  for (const link of entry.parameterLinks) {
    const [parameter] = await registry.findCanonicalMatches(link.code);
    if (!parameter) continue; // knowledge base points at a code not in the registry - link silently doesn't attach

    const { rows: inserted } = await pool.query(
      `INSERT INTO medication_parameter_links
         (medication_id, health_parameter_id, relationship, expected_direction, typical_onset_weeks_min, typical_onset_weeks_max, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (medication_id, health_parameter_id, relationship) DO UPDATE SET
         expected_direction = EXCLUDED.expected_direction,
         typical_onset_weeks_min = EXCLUDED.typical_onset_weeks_min,
         typical_onset_weeks_max = EXCLUDED.typical_onset_weeks_max,
         rationale = EXCLUDED.rationale
       RETURNING *`,
      [
        medicationId,
        parameter.id,
        link.relationship,
        link.direction,
        link.onsetWeeksMin ?? null,
        link.onsetWeeksMax ?? null,
        link.rationale,
      ]
    );
    linked.push(inserted[0]);
  }
  return linked;
}

module.exports = { findKnowledgeEntry, syncParameterLinks };
