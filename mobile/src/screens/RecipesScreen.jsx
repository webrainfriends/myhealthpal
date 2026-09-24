import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchSavedRecipes, generateRecipeFeed, logRecipeSuggestion } from '../api/client';
import { showAlert } from '../utils/alert';

// Matches the server's per-generation cap (dietRecipeService FEED_MAX_COUNT).
const GENERATE_COUNT = 5;

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

// A standalone recipe box - not a form embedded in the Diet screen. Opening
// it, or changing the meal filter, only ever reads recipes already
// generated (GET /recipes/feed, no AI call, no cost) - a new batch is
// generated only when the person explicitly taps "Generate", and every
// generated recipe is saved server-side (see dietRecipeService.js), so it's
// never lost to leaving the screen or restarting the app, and never
// re-generated (re-billed) for the same idea. Recipes are grounded in the
// person's lab results that need attention, recent activity, weight goal,
// and saved diet/cuisine preferences. "Add to diet" logs the recipe
// straight from its saved id (POST /recipes/:id/log) - the same action
// available from the Diet screen's own quick-pick list.
export default function RecipesScreen() {
  const [mealType, setMealType] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [considerations, setConsiderations] = useState([]);
  const [signals, setSignals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [addingId, setAddingId] = useState(null);

  const loadSaved = useCallback(async (type) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSavedRecipes({ mealType: type });
      setRecipes(data.recipes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSaved(mealType);
  }, [mealType, loadSaved]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const excludeTitles = recipes.map((r) => r.title);
      const data = await generateRecipeFeed({ mealType, excludeTitles, limit: GENERATE_COUNT });
      setRecipes((prev) => [...data.recipes, ...prev]);
      setConsiderations(data.considerations || []);
      setSignals(data.signals || null);
      if (data.recipes.length === 0) {
        showAlert('No new recipes', 'The AI did not return any new recipe ideas this time - try again.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAddToDiet(recipe) {
    setAddingId(recipe.id);
    try {
      await logRecipeSuggestion(recipe.id);
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, addedAt: new Date().toISOString() } : r)));
      showAlert('Added', `"${recipe.title}" was added to your diet log.`);
    } catch (err) {
      showAlert('Could not add this recipe', err.message);
    } finally {
      setAddingId(null);
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
            : 'Your saved AI recipe ideas, personalized from your health data and diet/cuisine preferences.'}
        </Text>

        <ChipSelect label="Meal (optional filter)" options={MEAL_TYPE_OPTIONS} value={mealType} onChange={setMealType} />

        <PrimaryButton
          title={recipes.length > 0 ? `Generate ${GENERATE_COUNT} new recipes` : `Generate ${GENERATE_COUNT} recipes`}
          onPress={handleGenerate}
          loading={generating}
          disabled={generating || loading}
        />
        <Text style={[typography.caption, styles.costHint]}>Each generation uses AI tokens - see Settings › AI usage.</Text>

        {loading && <ActivityIndicator style={styles.status} color={colors.primary} />}
        {!loading && error && <Text style={[typography.bodySecondary, styles.status]}>{error}</Text>}
        {!loading && !error && recipes.length === 0 && (
          <Text style={[typography.bodySecondary, styles.status]}>
            No recipes yet. Tap "Generate {GENERATE_COUNT} recipes" to get personalized ideas.
          </Text>
        )}

        {recipes.map((recipe) => {
          const expanded = expandedId === recipe.id;
          return (
            <View key={recipe.id} style={[styles.recipeCard, cardShadow]}>
              <TouchableOpacity onPress={() => setExpandedId(expanded ? null : recipe.id)}>
                <Text style={typography.title}>{recipe.title}</Text>
                {recipe.description && <Text style={typography.bodySecondary}>{recipe.description}</Text>}

                <View style={styles.metaRow}>
                  {recipe.mealType && <Text style={styles.mealTag}>{recipe.mealType}</Text>}
                  {recipe.servings != null && <Text style={typography.caption}>Serves {recipe.servings}</Text>}
                  {recipe.prepTimeMinutes != null && <Text style={typography.caption}>Prep {recipe.prepTimeMinutes} min</Text>}
                  {recipe.cookTimeMinutes != null && <Text style={typography.caption}>Cook {recipe.cookTimeMinutes} min</Text>}
                  {recipe.addedAt && <Text style={styles.addedTag}>✓ Added</Text>}
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
                title={recipe.addedAt ? 'Add to diet again' : 'Add to diet'}
                variant={recipe.addedAt ? 'secondary' : 'primary'}
                onPress={() => handleAddToDiet(recipe)}
                loading={addingId === recipe.id}
              />
            </View>
          );
        })}
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
  addedTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
    marginLeft: 'auto',
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
