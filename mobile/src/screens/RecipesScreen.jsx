import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { createFoodEntry, fetchDietRecipeFeed } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { showAlert } from '../utils/alert';

// Matches the server's per-request cap (dietRecipeService FEED_MAX_COUNT).
const PAGE_SIZE = 5;

// The last generated batch, kept for the life of the app so leaving the
// screen and coming back shows the recipes already paid for instead of an
// empty screen (or, as before, silently generating a new batch). Tagged
// with the user id: recipes are personalized from health data, so a
// different account signing in on the same device must never see them.
let lastFeed = null;

const MEAL_TYPE_OPTIONS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snack', label: 'Snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'supper', label: 'Supper' },
];

const NUTRITION_LABELS = [
  { key: 'calories', label: 'Calories', suffix: '' },
  { key: 'protein_g', label: 'Protein', suffix: 'g' },
  { key: 'carbs_g', label: 'Carbs', suffix: 'g' },
  { key: 'fat_g', label: 'Fat', suffix: 'g' },
  { key: 'fiber_g', label: 'Fiber', suffix: 'g' },
  { key: 'sugar_g', label: 'Sugar', suffix: 'g' },
];

const ACTIVITY_LEVEL_LABELS = {
  active: 'your activity level',
  'moderately active': 'your activity level',
  'low activity': 'your activity level',
};

// A standalone recipe feed - not a form embedded in the Diet screen. Every
// generation costs AI tokens, so nothing is generated until the person taps
// "Generate recipes" (never on open, and never just from changing the meal
// filter). Recipes are grounded in the person's lab results that need
// attention, recent activity, weight goal, and saved diet/cuisine
// preferences (see dietRecipeService.generateRecipeFeed server-side). "Add
// to Diet" on a card is the same food_entries POST the manual/scanned flows
// use.
export default function RecipesScreen({ navigation }) {
  const { user } = useAuth();
  const saved = lastFeed && lastFeed.userId === user?.id ? lastFeed : null;
  const [mealType, setMealType] = useState(saved?.mealType ?? null);
  const [recipes, setRecipes] = useState(saved?.recipes ?? []);
  const [considerations, setConsiderations] = useState(saved?.considerations ?? []);
  const [signals, setSignals] = useState(saved?.signals ?? null);
  const [hasMore, setHasMore] = useState(saved?.hasMore ?? false);
  const [generated, setGenerated] = useState(Boolean(saved));
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [expandedTitle, setExpandedTitle] = useState(null);
  const [addingTitle, setAddingTitle] = useState(null);

  function remember(next) {
    lastFeed = { userId: user?.id, mealType, recipes, considerations, signals, hasMore, ...next };
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDietRecipeFeed({ mealType, limit: PAGE_SIZE });
      const more = Boolean(data.hasMore) && data.recipes.length > 0;
      setRecipes(data.recipes);
      setConsiderations(data.considerations || []);
      setSignals(data.signals || null);
      setHasMore(more);
      setGenerated(true);
      remember({ recipes: data.recipes, considerations: data.considerations || [], signals: data.signals || null, hasMore: more });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const excludeTitles = recipes.map((r) => r.title);
      const data = await fetchDietRecipeFeed({ mealType, excludeTitles, limit: PAGE_SIZE });
      const nextRecipes = [...recipes, ...data.recipes];
      const more = Boolean(data.hasMore) && data.recipes.length > 0;
      setRecipes(nextRecipes);
      setHasMore(more);
      remember({ recipes: nextRecipes, hasMore: more });
    } catch (err) {
      showAlert('Could not load more recipes', err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleAddToDiet(recipe) {
    setAddingTitle(recipe.title);
    try {
      await createFoodEntry({
        name: recipe.title,
        notes: recipe.description || undefined,
        meal_type: recipe.mealType || undefined,
        ai_verified: true,
        ...recipe.nutritionPerServing,
      });
      showAlert('Added', `"${recipe.title}" was added to your diet log.`);
    } catch (err) {
      showAlert('Could not add this recipe', err.message);
    } finally {
      setAddingTitle(null);
    }
  }

  const signalNotes = [];
  if (signals?.activityLevel) signalNotes.push(ACTIVITY_LEVEL_LABELS[signals.activityLevel] || 'your activity level');
  if (signals?.weightGoalSet) signalNotes.push('your weight goal');
  if (considerations.length > 0) signalNotes.push(considerations.map((c) => c.label).join(', '));

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>AI recipe ideas</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>
          {signalNotes.length > 0
            ? `Personalized for you, based on ${signalNotes.join(', ')}, and your diet/cuisine preferences.`
            : 'Personalized for you, based on your health data and diet/cuisine preferences.'}
        </Text>

        <ChipSelect label="Meal (optional filter)" options={MEAL_TYPE_OPTIONS} value={mealType} onChange={setMealType} />

        <PrimaryButton
          title={generated ? `Generate ${PAGE_SIZE} new recipes` : `Generate ${PAGE_SIZE} recipes`}
          onPress={handleGenerate}
          loading={loading}
          disabled={loading || loadingMore}
        />
        <Text style={[typography.caption, styles.costHint]}>Each generation uses AI tokens - see Settings › AI usage.</Text>

        {loading && <Text style={[typography.bodySecondary, styles.status]}>Generating recipes for you…</Text>}
        {!loading && error && <Text style={[typography.bodySecondary, styles.status]}>{error}</Text>}
        {!loading && !error && generated && recipes.length === 0 && (
          <Text style={[typography.bodySecondary, styles.status]}>No recipes came back this time. Please try again.</Text>
        )}

        {recipes.map((recipe) => {
          const expanded = expandedTitle === recipe.title;
          return (
            <View key={recipe.title} style={[styles.recipeCard, cardShadow]}>
              <TouchableOpacity onPress={() => setExpandedTitle(expanded ? null : recipe.title)}>
                <Text style={typography.title}>{recipe.title}</Text>
                {recipe.description && <Text style={typography.bodySecondary}>{recipe.description}</Text>}

                <View style={styles.metaRow}>
                  {recipe.mealType && <Text style={styles.mealTag}>{recipe.mealType}</Text>}
                  {recipe.servings != null && <Text style={typography.caption}>Serves {recipe.servings}</Text>}
                  {recipe.prepTimeMinutes != null && <Text style={typography.caption}>Prep {recipe.prepTimeMinutes} min</Text>}
                  {recipe.cookTimeMinutes != null && <Text style={typography.caption}>Cook {recipe.cookTimeMinutes} min</Text>}
                </View>

                {recipe.dietaryTags.length > 0 && (
                  <View style={styles.tagRow}>
                    {recipe.dietaryTags.map((tag) => (
                      <View key={tag} style={styles.tagPill}>
                        <Text style={styles.tagPillText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.nutritionGrid}>
                  {NUTRITION_LABELS.map((n) => (
                    <View key={n.key} style={styles.nutritionItem}>
                      <Text style={typography.caption}>{n.label}</Text>
                      <Text style={typography.body}>
                        {recipe.nutritionPerServing[n.key] != null ? Math.round(recipe.nutritionPerServing[n.key]) : '—'}{n.suffix}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.expandHint}>{expanded ? 'Hide details ▴' : 'Show ingredients & instructions ▾'}</Text>
              </TouchableOpacity>

              {expanded && (
                <View style={styles.details}>
                  {recipe.whyThisRecipe && (
                    <View style={styles.whyBox}>
                      <Text style={typography.bodySecondary}>{recipe.whyThisRecipe}</Text>
                    </View>
                  )}

                  <Text style={[typography.heading, styles.subheading]}>Ingredients</Text>
                  {recipe.ingredients.map((ing, i) => (
                    <Text key={i} style={typography.body}>
                      • {ing.amount ? `${ing.amount} ` : ''}{ing.item}
                    </Text>
                  ))}

                  <Text style={[typography.heading, styles.subheading]}>Instructions</Text>
                  {recipe.instructions.map((step, i) => (
                    <Text key={i} style={[typography.body, styles.step]}>
                      {i + 1}. {step}
                    </Text>
                  ))}
                </View>
              )}

              <PrimaryButton
                title="Add to diet"
                onPress={() => handleAddToDiet(recipe)}
                loading={addingTitle === recipe.title}
              />
            </View>
          );
        })}

        {!loading && recipes.length > 0 && hasMore && (
          <PrimaryButton
            title={`Load ${PAGE_SIZE} more`}
            variant="secondary"
            onPress={handleLoadMore}
            loading={loadingMore}
            disabled={loadingMore}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  subtitle: {
    marginTop: -spacing.sm,
  },
  status: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  costHint: {
    textAlign: 'center',
    marginTop: -spacing.sm,
  },
  recipeCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  mealTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    backgroundColor: colors.successMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  tagPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  nutritionItem: {
    minWidth: 70,
  },
  expandHint: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
    marginTop: spacing.xs,
  },
  details: {
    gap: spacing.sm,
  },
  whyBox: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  subheading: {
    marginTop: spacing.xs,
  },
  step: {
    marginTop: 2,
  },
});
