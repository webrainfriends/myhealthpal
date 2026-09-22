import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { createFoodEntry, generateDietRecipe } from '../api/client';
import { showAlert } from '../utils/alert';

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
  { key: 'sodium_mg', label: 'Sodium', suffix: 'mg' },
  { key: 'iron_mg', label: 'Iron', suffix: 'mg' },
];

export default function DietRecipeScreen({ navigation }) {
  const [mealType, setMealType] = useState(null);
  const [preferences, setPreferences] = useState('');
  const [generating, setGenerating] = useState(false);
  const [logging, setLogging] = useState(false);
  const [result, setResult] = useState(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const data = await generateDietRecipe({ meal_type: mealType || undefined, preferences: preferences.trim() || undefined });
      setResult(data);
    } catch (err) {
      showAlert('Could not generate a recipe', err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleLog() {
    if (!result?.recipe) return;
    setLogging(true);
    try {
      const { recipe } = result;
      await createFoodEntry({
        name: recipe.title,
        notes: recipe.description || undefined,
        meal_type: mealType || undefined,
        ai_verified: true,
        ...recipe.nutritionPerServing,
      });
      showAlert('Logged', `"${recipe.title}" was added to your diet log.`);
      navigation.navigate('Diet');
    } catch (err) {
      showAlert('Could not log this recipe', err.message);
    } finally {
      setLogging(false);
    }
  }

  const recipe = result?.recipe;
  const considerations = result?.considerations || [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Recipe ideas</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>
          Generate a recipe idea, informed by anything relevant from your active medications or recent lab results.
        </Text>

        <ChipSelect label="Meal (optional)" options={MEAL_TYPE_OPTIONS} value={mealType} onChange={setMealType} />
        <View style={styles.field}>
          <Text style={styles.label}>Preferences (optional)</Text>
          <TextInput
            style={styles.textArea}
            value={preferences}
            onChangeText={setPreferences}
            placeholder="e.g. vegetarian, use chicken and spinach, no dairy, quick to make"
            placeholderTextColor={colors.textTertiary}
            multiline
          />
        </View>

        <PrimaryButton title={recipe ? 'Generate another' : 'Generate recipe'} onPress={handleGenerate} loading={generating} />

        {recipe && (
          <View style={[styles.recipeCard, cardShadow]}>
            <Text style={typography.title}>{recipe.title}</Text>
            {recipe.description && <Text style={typography.bodySecondary}>{recipe.description}</Text>}

            <View style={styles.metaRow}>
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

            {recipe.whyThisRecipe && (
              <View style={styles.whyBox}>
                <Text style={typography.bodySecondary}>{recipe.whyThisRecipe}</Text>
              </View>
            )}

            {considerations.length > 0 && (
              <Text style={typography.caption}>
                Considered: {considerations.map((c) => c.label).join(', ')}
              </Text>
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

            <Text style={[typography.heading, styles.subheading]}>Nutrition per serving</Text>
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

            <PrimaryButton title="Log this recipe" onPress={handleLog} loading={logging} />
          </View>
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
  field: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
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
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  nutritionItem: {
    minWidth: 70,
  },
});
