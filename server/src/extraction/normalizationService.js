const registry = require('./registry');

const QUALITATIVE_WORDS = new Set([
  'trace',
  'positive',
  'negative',
  'not detected',
  'detected',
  'reactive',
  'non-reactive',
  'nil',
  'absent',
  'present',
]);

function classifyValue(rawValue) {
  const value = String(rawValue || '').trim();

  const inequalityMatch = /^(<=|>=|<|>)\s*(\d+(?:\.\d+)?)$/.exec(value);
  if (inequalityMatch) {
    return {
      valueType: 'inequality',
      comparator: inequalityMatch[1],
      numericValue: Number.parseFloat(inequalityMatch[2]),
      qualitativeValue: null,
    };
  }

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return { valueType: 'numeric', comparator: null, numericValue: Number.parseFloat(value), qualitativeValue: null };
  }

  if (QUALITATIVE_WORDS.has(value.toLowerCase())) {
    return { valueType: 'qualitative', comparator: null, numericValue: null, qualitativeValue: value };
  }

  return { valueType: 'coded', comparator: null, numericValue: null, qualitativeValue: value };
}

function parseEffectiveDate(dateString) {
  if (!dateString) return null;
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Maps one raw extraction candidate ({test_name, value, unit, reference_range,
// status_flag, date, confidence, raw_source_text}) onto the Health Parameter
// Registry, producing a measurement record ready for persistence. Never
// guesses a canonical identity when the mapping is ambiguous or absent —
// those are surfaced via `needsReview` instead.
async function normalizeCandidate(candidate) {
  const { valueType, comparator, numericValue, qualitativeValue } = classifyValue(candidate.value);

  const matches = await registry.findCanonicalMatches(candidate.test_name);
  const isAmbiguous = matches.length > 1;
  const matchedParameter = matches.length === 1 ? matches[0] : null;

  let normalizedUnit = null;
  let normalizedValue = null;
  let normalizationConfidence = null;

  if (matchedParameter) {
    if (numericValue !== null && candidate.unit) {
      const conversion = await registry.convertToCanonicalUnit(matchedParameter, numericValue, candidate.unit);
      if (conversion) {
        normalizedUnit = conversion.normalizedUnit;
        normalizedValue = conversion.normalizedValue;
        normalizationConfidence = 1.0;
      } else {
        // Mapped to a canonical parameter, but the unit couldn't be safely
        // converted (unknown unit or no conversion rule) — never fabricate one.
        normalizationConfidence = 0.5;
      }
    } else {
      // Qualitative/coded/unitless results map identity-only; no conversion needed.
      normalizedUnit = candidate.unit || null;
      normalizedValue = numericValue;
      normalizationConfidence = 0.9;
    }
  }

  const needsReview =
    Boolean(candidate.needs_review) ||
    !matchedParameter ||
    (matchedParameter && numericValue !== null && candidate.unit && normalizedUnit === null);

  return {
    raw_test_name: candidate.test_name,
    raw_value: candidate.value,
    raw_unit: candidate.unit || null,
    value_type: valueType,
    comparator,
    numeric_value: numericValue,
    qualitative_value: qualitativeValue,
    normalized_unit: normalizedUnit,
    normalized_value: normalizedValue,
    reference_range_raw: candidate.reference_range || null,
    reference_range_context: null,
    status_flag: candidate.status_flag || null,
    panel_category: matchedParameter ? matchedParameter.category : null,
    sample_datetime: parseEffectiveDate(candidate.param_date),
    result_datetime: null,
    extraction_confidence: candidate.confidence,
    normalization_confidence: normalizationConfidence,
    ambiguous_candidate_ids: isAmbiguous ? matches.map((m) => m.id) : null,
    needs_review: needsReview,
    health_parameter_id: matchedParameter ? matchedParameter.id : null,
    raw_source_text: candidate.raw_source_text || null,
  };
}

async function normalizeCandidates(candidates) {
  const measurements = [];
  for (const candidate of candidates) {
    measurements.push(await normalizeCandidate(candidate));
  }
  return measurements;
}

module.exports = { normalizeCandidates, classifyValue };
