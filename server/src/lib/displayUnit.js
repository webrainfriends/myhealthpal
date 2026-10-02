// The unit to show next to a result's printed value. The value shown is always
// the one the report printed, so the unit stays the printed one too - except
// where the printed unit is known not to belong to the result:
//   - a unitless parameter (a ratio, pH, a score) has no unit at all, so
//     anything captured next to it ("%" read beside an AST/ALT ratio) came
//     from a neighbouring column;
//   - a unit-corrected result (normalization_confidence 0.6, set when the
//     printed unit couldn't belong to the test, e.g. "%" beside AST in U/L)
//     is shown in the parameter's own unit.
// Row fields are the snake_case columns (health_measurements + the joined
// health_parameters.canonical_unit); `health_parameter_id` marks "mapped".
const UNIT_CORRECTED_CONFIDENCE = 0.6;

function displayUnit(row) {
  const mapped = Boolean(row.health_parameter_id || row.has_parameter);
  if (mapped && !row.canonical_unit) return null;
  if (
    mapped &&
    row.normalized_unit &&
    row.normalization_confidence !== null &&
    row.normalization_confidence !== undefined &&
    Number(row.normalization_confidence) === UNIT_CORRECTED_CONFIDENCE
  ) {
    return row.normalized_unit;
  }
  return row.raw_unit || null;
}

module.exports = { displayUnit };
