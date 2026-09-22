const { NUTRIENT_FIELDS } = require('../extraction/providers/nutrientFields');

// Whether two possibly-string/possibly-null numeric values actually
// differ - used to tell "this field was resent unchanged" (the mobile
// screens always PATCH/PUT the whole entry object, not a diff) apart from
// "this field's value actually changed".
function numbersDiffer(a, b) {
  const na = a == null ? null : Number(a);
  const nb = b == null ? null : Number(b);
  if (na === null || nb === null) return na !== nb;
  return Math.abs(na - nb) > 1e-9;
}

// Whether a PATCH actually changed any nutrition-affecting value (a
// nutrient field, or the quantity/unit an estimate would have been scaled
// to) - not merely whether the field was present in the request body.
function nutritionValuesChanged(body, next, existing) {
  for (const field of [...NUTRIENT_FIELDS, 'quantity_amount']) {
    if (body[field] !== undefined && numbersDiffer(next[field], existing[field])) return true;
  }
  if (body.quantity_unit !== undefined && (body.quantity_unit || null) !== (existing.quantity_unit || null)) return true;
  return false;
}

// Decides the ai_verified value for a save. An explicit true/false from
// the client always wins (the mobile form sends true right after merging a
// fresh "Estimate with AI" result, false as soon as a person types over
// any nutrition value by hand); otherwise a real change to a
// nutrition-affecting field resets it to false as a safety net; otherwise
// the existing value (or, on create, whether the server's own auto-estimate
// succeeded) is left alone.
function computeAiVerified({ explicitValue, nutritionChanged, fallback }) {
  if (explicitValue === true || explicitValue === false) return explicitValue;
  if (nutritionChanged) return false;
  return fallback;
}

module.exports = { numbersDiffer, nutritionValuesChanged, computeAiVerified };
