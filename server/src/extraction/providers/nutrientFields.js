// The full nutrient set a food_entries row can carry (mirrors
// 012_diet_tracking.sql + 013_diet_micronutrients.sql: the FDA Nutrition
// Facts label's standard nutrients). Shared by every AI estimator that
// fills these in - dietPhotoProvider.js (from a photo) and
// dietTextProvider.js (from a typed name/recipe) - so both providers stay
// in lockstep with what the schema actually stores and never describe the
// same field two different ways.
const NUTRIENT_FIELDS = [
  'calories', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'fiber_g', 'sugar_g',
  'sodium_mg', 'cholesterol_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'vitamin_d_mcg',
];

const NUTRIENT_LABELS = {
  calories: 'Estimated total calories (kcal)',
  protein_g: 'Estimated protein in grams',
  carbs_g: 'Estimated carbohydrates in grams',
  fat_g: 'Estimated fat in grams',
  saturated_fat_g: 'Estimated saturated fat in grams',
  fiber_g: 'Estimated fiber in grams',
  sugar_g: 'Estimated sugar in grams',
  sodium_mg: 'Estimated sodium in milligrams',
  cholesterol_mg: 'Estimated dietary cholesterol in milligrams',
  potassium_mg: 'Estimated potassium in milligrams',
  calcium_mg: 'Estimated calcium in milligrams',
  iron_mg: 'Estimated iron in milligrams',
  vitamin_d_mcg: 'Estimated vitamin D in micrograms',
};

// JSON-schema `properties` fragment for the 13 nutrient fields, for the
// portion/quantity actually being estimated for - the caller appends
// ", or null if not confidently known" to each description via
// `forPortion` so the same fragment reads correctly whether it's
// describing "the portion shown" (a photo) or "the quantity estimated for"
// (a typed description).
function nutrientToolProperties(forPortion) {
  const properties = {};
  for (const field of NUTRIENT_FIELDS) {
    properties[field] = { type: ['number', 'null'], description: `${NUTRIENT_LABELS[field]} for ${forPortion}, or null.` };
  }
  return properties;
}

module.exports = { NUTRIENT_FIELDS, nutrientToolProperties };
