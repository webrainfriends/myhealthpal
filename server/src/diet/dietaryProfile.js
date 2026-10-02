const pool = require('../db/pool');

// The person's saved diet-type preferences (vegetarian / vegan /
// non_vegetarian) and allergies, turned into hard constraints for diet
// recommendations. Unlike the recipe feed, which falls back to default diet
// types for a user who never chose any, a recommendation only restricts on
// what the person actually saved - guessing "vegan" for someone who never
// said so would be wrong in the other direction.

// Free-text allergens are matched loosely: "lactose", "milk" and "dairy" all
// mean the same family of foods, so a stored allergy of any one of them
// rules out all of them.
const ALLERGEN_FAMILIES = [
  ['dairy', 'milk', 'lactose', 'cheese', 'yogurt', 'yoghurt', 'curd', 'paneer', 'butter', 'ghee', 'cream', 'whey', 'casein'],
  ['gluten', 'wheat', 'barley', 'rye', 'grain', 'bread', 'pasta'],
  ['egg'],
  ['fish', 'seafood', 'shellfish', 'shrimp', 'prawn', 'crab'],
  ['nut', 'peanut', 'almond', 'cashew', 'walnut', 'pistachio'],
  ['soy', 'tofu', 'tempeh'],
  ['legume', 'lentil', 'chickpea', 'bean', 'pea'],
  ['sesame', 'seed'],
];

async function fetchDietaryProfile(userId) {
  const [prefs, allergies] = await Promise.all([
    pool.query(
      `SELECT preference_value FROM user_recipe_preferences WHERE user_id = $1 AND preference_type = 'diet_type'`,
      [userId]
    ),
    pool.query('SELECT allergen FROM user_allergies WHERE user_id = $1 ORDER BY allergen', [userId]),
  ]);
  return buildDietaryProfile(prefs.rows.map((r) => r.preference_value), allergies.rows.map((r) => r.allergen));
}

function buildDietaryProfile(dietTypes, allergens) {
  const types = [...new Set(dietTypes)].sort();
  const hasPreference = types.length > 0;
  // Selecting several types means "any of these is fine", so a restriction
  // applies only when none of the selected types allows the food.
  const allowsMeat = !hasPreference || types.includes('non_vegetarian');
  const allowsAnimalProducts = allowsMeat || types.includes('vegetarian');

  const allergenTerms = new Set();
  for (const raw of allergens) {
    const a = String(raw).trim().toLowerCase();
    if (!a) continue;
    allergenTerms.add(a);
    for (const family of ALLERGEN_FAMILIES) {
      if (family.some((term) => a.includes(term) || (a.length >= 3 && term.includes(a)))) family.forEach((t) => allergenTerms.add(t));
    }
  }

  return {
    dietTypes: types,
    allergens: [...allergens].map((a) => String(a).trim()).filter(Boolean).sort(),
    allowsMeat,
    allowsAnimalProducts,
    allergenTerms: [...allergenTerms],
  };
}

// An item is { text, requires?: 'meat' | 'animal', keywords?: string }.
// 'meat' needs a non-vegetarian diet; 'animal' (dairy, eggs, honey) is
// ruled out only for vegan. keywords are what an allergen is matched against.
function isAllowed(item, profile) {
  if (!profile) return true;
  if (item.requires === 'meat' && !profile.allowsMeat) return false;
  if (item.requires === 'animal' && !profile.allowsAnimalProducts) return false;
  const haystack = `${item.text} ${item.keywords || ''}`.toLowerCase();
  return !profile.allergenTerms.some((term) => haystack.includes(term));
}

function filterAllowed(items, profile) {
  return items.filter((item) => isAllowed(item, profile));
}

// "a, b, and c" - for a list of food names inside a sentence.
function joinList(texts) {
  if (texts.length <= 1) return texts.join('');
  if (texts.length === 2) return `${texts[0]} and ${texts[1]}`;
  return `${texts.slice(0, -1).join(', ')}, and ${texts[texts.length - 1]}`;
}

// Short human description for the AI prompt.
function describeProfileForPrompt(profile) {
  if (!profile) return 'No diet-type preference or allergies are on file.';
  const parts = [];
  if (profile.dietTypes.length > 0) {
    parts.push(`Diet type(s): ${profile.dietTypes.join('/').replace(/_/g, ' ')}.`);
    if (!profile.allowsMeat) parts.push('Never mention or suggest meat, poultry, fish or seafood.');
    if (!profile.allowsAnimalProducts) parts.push('Never mention or suggest dairy, eggs, honey or any animal product.');
  }
  if (profile.allergens.length > 0) {
    parts.push(`Allergic to: ${profile.allergens.join(', ')}. Never mention or suggest these foods or obvious variants.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'No diet-type preference or allergies are on file.';
}

module.exports = { fetchDietaryProfile, buildDietaryProfile, isAllowed, filterAllowed, joinList, describeProfileForPrompt };
