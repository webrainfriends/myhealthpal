// Picks an emoji for a logged food from its name, falling back to a
// meal-type icon. Order matters: the first matching rule wins, so more
// specific words (e.g. "ice cream") come before generic ones.
const FOOD_RULES = [
  [/\b(coffee|espresso|latte|cappuccino|mocha|americano|macchiato|chai)\b/, '☕'],
  [/\b(tea|matcha)\b/, '🍵'],
  [/\b(ice ?cream|gelato|kulfi)\b/, '🍨'],
  [/\b(smoothie|juice|lemonade|shake|soda|cola|coke)\b/, '🥤'],
  [/\b(water)\b/, '💧'],
  [/\b(milk|lassi|buttermilk|yogh?urt|curd|dahi)\b/, '🥛'],
  [/\b(beer|wine|whisk(e)?y|vodka|cocktail)\b/, '🍺'],
  [/\b(egg|eggs|omelet|omelette)\b/, '🍳'],
  [/\b(pizza)\b/, '🍕'],
  [/\b(burger|hamburger|cheeseburger)\b/, '🍔'],
  [/\b(fries|french fries)\b/, '🍟'],
  [/\b(hot ?dog|sausage)\b/, '🌭'],
  [/\b(sandwich|sub|toast)\b/, '🥪'],
  [/\b(taco)\b/, '🌮'],
  [/\b(burrito|wrap|roll|paratha|roti|chapati|naan)\b/, '🌯'],
  [/\b(sushi)\b/, '🍣'],
  [/\b(ramen|noodles?|pasta|spaghetti|macaroni)\b/, '🍝'],
  [/\b(rice|biryani|pulao|khichdi|poha|upma)\b/, '🍚'],
  [/\b(curry|dal|daal|sambar|soup|stew)\b/, '🍲'],
  [/\b(salad)\b/, '🥗'],
  [/\b(bread|bagel|croissant|bun)\b/, '🍞'],
  [/\b(pancake|waffle|dosa|idli|uttapam)\b/, '🥞'],
  [/\b(cake|cupcake|brownie|pastry|muffin)\b/, '🍰'],
  [/\b(cookie|biscuit)s?\b/, '🍪'],
  [/\b(chocolate)\b/, '🍫'],
  [/\b(candy|sweet|halwa|ladoo|jalebi|gulab jamun)\b/, '🍬'],
  [/\b(donut|doughnut)\b/, '🍩'],
  [/\b(chips|crisps|popcorn|namkeen|samosa|pakora)\b/, '🍿'],
  [/\b(cheese|paneer)\b/, '🧀'],
  [/\b(chicken|turkey|drumstick)\b/, '🍗'],
  [/\b(steak|beef|mutton|lamb|pork|bacon|ham|meat)\b/, '🥩'],
  [/\b(fish|salmon|tuna|shrimp|prawn|seafood)\b/, '🐟'],
  [/\b(apple)\b/, '🍎'],
  [/\b(banana)\b/, '🍌'],
  [/\b(orange|mandarin|tangerine)\b/, '🍊'],
  [/\b(grapes?)\b/, '🍇'],
  [/\b(strawberry|strawberries|berries|blueberry|blueberries)\b/, '🍓'],
  [/\b(mango)\b/, '🥭'],
  [/\b(watermelon|melon)\b/, '🍉'],
  [/\b(pineapple)\b/, '🍍'],
  [/\b(peach|pear)\b/, '🍑'],
  [/\b(avocado)\b/, '🥑'],
  [/\b(carrot)\b/, '🥕'],
  [/\b(broccoli|spinach|kale|cabbage|veg(etable)?s?)\b/, '🥦'],
  [/\b(corn)\b/, '🌽'],
  [/\b(potato|potatoes|aloo)\b/, '🥔'],
  [/\b(tomato)\b/, '🍅'],
  [/\b(nuts?|almonds?|peanuts?|cashews?|walnuts?|pistachios?)\b/, '🥜'],
  [/\b(oats|oatmeal|cereal|granola|porridge)\b/, '🥣'],
];

const MEAL_ICONS = { breakfast: '🍳', lunch: '🥗', snack: '🍽️', dinner: '🍝', supper: '🌙' };

export function foodIcon(name, mealType) {
  const text = typeof name === 'string' ? name.toLowerCase() : '';
  if (text) {
    for (const [pattern, icon] of FOOD_RULES) {
      if (pattern.test(text)) return icon;
    }
  }
  return MEAL_ICONS[mealType] || MEAL_ICONS.snack;
}
