const { NUTRIENT_FIELDS } = require('../extraction/providers/nutrientFields');

// Deterministic sanity checks on a food entry's nutrition numbers. An AI
// estimate (or a typed value) can be internally impossible - 0.2 kcal for
// two servings of chutney, which is really a per-gram or per-unit figure that
// was never scaled to the quantity - and nothing downstream notices. These
// checks never *fix* a number; they report what looks wrong so the caller can
// ask the model to retry, mark the entry for review, or reject plainly
// invalid input.
//
// Two severities:
//   'error'   - cannot be true (negative amount, sugar greater than carbs).
//   'warning' - very unlikely (kcal far from the macros, kcal per gram off).

const GRAMS_PER_UNIT = { g: 1, ml: 1, oz: 28.35, tsp: 5, tbsp: 15, cup: 240 };

// Foods/drinks that genuinely have ~0 kcal, so a tiny calorie number is not
// a red flag for them.
const ZERO_CALORIE_NAME = /\b(water|black coffee|black tea|green tea|herbal tea|plain tea|diet|zero|sugar[- ]?free|soda water|club soda|sparkling|lemon water|ice|salt|spice|masala powder|vinegar)\b/i;

// kcal/g bounds for plausibility. Pure fat is ~9; alcohol 7; nothing edible
// is meaningfully higher. At the low end, even watery vegetables are ~0.1.
const MAX_KCAL_PER_GRAM = 9.5;
const MIN_KCAL_PER_GRAM = 0.08;
const MIN_FOOD_CALORIES = 5;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Possible total weights (grams) of the logged portion. "serving"/"piece"
// are ambiguous: serving_size_grams is sometimes the weight of one serving
// and sometimes of the whole estimated portion, so both readings are tried
// and a number only counts as implausible if it is implausible under both.
function gramCandidates(entry) {
  const amount = num(entry.quantity_amount);
  const unit = entry.quantity_unit;
  const serving = num(entry.serving_size_grams);
  const out = [];
  if (amount !== null && amount > 0 && GRAMS_PER_UNIT[unit]) out.push(amount * GRAMS_PER_UNIT[unit]);
  else if (serving !== null && serving > 0) {
    out.push(serving);
    if (amount !== null && amount > 1) out.push(serving * amount);
  }
  return out;
}

function checkPlausibility(entry) {
  const issues = [];
  const add = (code, severity, field, message) => issues.push({ code, severity, field, message });
  const value = {};
  for (const field of NUTRIENT_FIELDS) value[field] = num(entry[field]);

  for (const field of NUTRIENT_FIELDS) {
    if (value[field] !== null && value[field] < 0) add('NEGATIVE', 'error', field, `${field} cannot be negative.`);
  }

  const { calories, protein_g: protein, carbs_g: carbs, fat_g: fat } = value;
  const slack = (n) => Math.max(0.5, n * 0.05);
  if (value.sugar_g !== null && carbs !== null && value.sugar_g > carbs + slack(carbs)) {
    add('SUGAR_GT_CARBS', 'error', 'sugar_g', 'Sugar cannot be more than total carbohydrates.');
  }
  if (value.fiber_g !== null && carbs !== null && value.fiber_g > carbs + slack(carbs)) {
    add('FIBER_GT_CARBS', 'error', 'fiber_g', 'Fiber cannot be more than total carbohydrates.');
  }
  if (value.saturated_fat_g !== null && fat !== null && value.saturated_fat_g > fat + slack(fat)) {
    add('SATFAT_GT_FAT', 'error', 'saturated_fat_g', 'Saturated fat cannot be more than total fat.');
  }

  const zeroCalorieFood = ZERO_CALORIE_NAME.test(String(entry.name || ''));
  let suggestedCalories = null;

  if (calories !== null && calories >= 0) {
    if (calories < MIN_FOOD_CALORIES && !zeroCalorieFood) {
      add(
        'CALORIES_TOO_LOW',
        'warning',
        'calories',
        `${calories} kcal is unusually low for this food - it may be a per-gram or per-unit figure rather than the total.`
      );
    }

    const grams = gramCandidates(entry);
    if (grams.length > 0 && calories >= MIN_FOOD_CALORIES) {
      const perGram = grams.map((g) => calories / g);
      if (perGram.every((p) => p > MAX_KCAL_PER_GRAM)) {
        add('CALORIES_PER_GRAM_HIGH', 'warning', 'calories', 'More calories than any food has for this weight; the quantity or calories look wrong.');
      }
    }
    if (grams.length > 0 && calories > 0 && !zeroCalorieFood && calories >= MIN_FOOD_CALORIES) {
      if (grams.every((g) => calories / g < MIN_KCAL_PER_GRAM)) {
        add('CALORIES_PER_GRAM_LOW', 'warning', 'calories', 'Very few calories for this weight of food; check the calories or the quantity.');
      }
    }

    if (protein !== null && carbs !== null && fat !== null) {
      const fromMacros = 4 * protein + 4 * carbs + 9 * fat;
      const tolerance = Math.max(15, 0.25 * Math.max(calories, fromMacros));
      if (Math.abs(fromMacros - calories) > tolerance) {
        suggestedCalories = Math.round(fromMacros);
        add(
          'MACROS_MISMATCH',
          'warning',
          'calories',
          `Calories (${calories}) do not match the macros, which add up to about ${suggestedCalories} kcal.`
        );
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { issues, errors, warnings, ok: issues.length === 0, suggestedCalories };
}

// One short line for a person (or a retry prompt) summarizing the problems.
function summarizeIssues(result) {
  return result.issues.map((i) => i.message).join(' ');
}

module.exports = { checkPlausibility, summarizeIssues, gramCandidates, GRAMS_PER_UNIT };
