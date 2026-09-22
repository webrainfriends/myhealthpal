import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MultiChipSelect from '../components/MultiChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import { fetchRecipePreferences, saveRecipePreferences } from '../api/client';
import { showAlert } from '../utils/alert';

// Kept in sync with the CHECK constraint in migration 012 and the allow
// lists in routes/recipePreferences.js.
const DIET_TYPE_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'non_vegetarian', label: 'Non-Vegetarian' },
];

const CUISINE_OPTIONS = [
  { value: 'south_indian', label: 'South Indian' },
  { value: 'north_indian', label: 'North Indian' },
  { value: 'western', label: 'Western' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'east_asian', label: 'East Asian' },
  { value: 'middle_eastern', label: 'Middle Eastern' },
];

// Diet-type + cuisine preferences that drive which recipes get suggested
// elsewhere in the app (aimed at moving lab results and weight-loss goals
// in the right direction) - its own screen off Settings since it's a
// distinct, occasionally-revisited preference rather than a one-time
// setup step.
export default function RecipePreferencesScreen() {
  const [dietTypes, setDietTypes] = useState([]);
  const [cuisines, setCuisines] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchRecipePreferences();
      setDietTypes(data.dietTypes);
      setCuisines(data.cuisines);
    } catch (err) {
      showAlert('Could not load preferences', err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setBusy(true);
    try {
      await saveRecipePreferences(dietTypes, cuisines);
      showAlert('Saved', 'Your recipe preferences have been updated.');
    } catch (err) {
      showAlert('Could not save preferences', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>
          Choose the diets and cuisines you'd like recipe suggestions drawn from. We'll prioritize recipes that help
          move your lab results and weight-loss goals in the right direction. You can pick more than one of each.
        </Text>

        <View style={[styles.card, styles.section]}>
          <MultiChipSelect
            label="Dietary preference"
            options={DIET_TYPE_OPTIONS}
            value={dietTypes}
            onChange={setDietTypes}
          />
        </View>

        <View style={[styles.card, styles.section]}>
          <MultiChipSelect label="Cuisine" options={CUISINE_OPTIONS} value={cuisines} onChange={setCuisines} />
        </View>

        <PrimaryButton title="Save preferences" onPress={handleSave} loading={busy} />
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
    gap: spacing.lg,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
});
