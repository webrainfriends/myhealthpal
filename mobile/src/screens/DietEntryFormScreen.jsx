import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FoodEntryForm from '../components/FoodEntryForm';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { createFoodEntry, deleteFoodEntry, estimateFoodNutrition, fetchFoodEntry, updateFoodEntry } from '../api/client';
import { showAlert } from '../utils/alert';

// Mirrors dietScanService.js's classifyMealType - a client-side-only
// convenience so a brand-new manual entry defaults to a sensible meal
// before the user has touched anything; the server re-derives/validates
// this on save regardless, so drift between the two bands is harmless.
function defaultMealType() {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 18) return 'snack';
  if (hour >= 18 && hour < 21.5) return 'dinner';
  if (hour >= 21.5) return 'supper';
  return 'snack';
}

function emptyEntry() {
  return {
    name: '',
    brand: null,
    quantity_amount: null,
    quantity_unit: null,
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    sodium_mg: null,
    meal_type: defaultMealType(),
    consumed_at: new Date().toISOString(),
    notes: null,
  };
}

export default function DietEntryFormScreen({ route, navigation }) {
  const entryId = route.params?.entryId;
  const [entry, setEntry] = useState(entryId ? null : emptyEntry());
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);

  useEffect(() => {
    if (!entryId) return;
    fetchFoodEntry(entryId)
      .then((data) => setEntry(data.entry))
      .catch((err) => showAlert('Could not load item', err.message));
  }, [entryId]);

  // Explicit re-estimate (e.g. after changing the name/brand/quantity) -
  // saving a brand-new manual entry with no calories given also gets this
  // automatically server-side (routes/diet.js's POST /entries), so this is
  // for previewing/adjusting the AI numbers before that, not the only path
  // to getting them.
  async function handleEstimate() {
    if (!entry.name || !entry.name.trim()) return;
    setEstimating(true);
    try {
      const result = await estimateFoodNutrition({
        name: entry.name,
        brand: entry.brand || undefined,
        quantity_amount: entry.quantity_amount ?? undefined,
        quantity_unit: entry.quantity_unit || undefined,
      });
      if (!result.recognized) {
        showAlert('Could not identify this food', `"${entry.name}" wasn't recognized - enter the nutrition details manually.`);
        return;
      }
      const { recognized, matched_food_description, confidence, ...patch } = result;
      setEntry((prev) => ({ ...prev, ...patch, needs_quantity: false, ai_verified: true }));
    } catch (err) {
      showAlert('Could not estimate nutrition', err.message);
    } finally {
      setEstimating(false);
    }
  }

  async function handleSave() {
    if (!entry.name || !entry.name.trim()) {
      showAlert('Name required', 'Enter a name for this item.');
      return;
    }
    setSaving(true);
    try {
      if (entryId) {
        await updateFoodEntry(entryId, entry);
      } else {
        await createFoodEntry(entry);
      }
      navigation.goBack();
    } catch (err) {
      showAlert('Could not save item', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteFoodEntry(entryId);
      navigation.goBack();
    } catch (err) {
      showAlert('Could not delete item', err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>{entryId ? 'Edit item' : 'Add item'}</Text>
        <FoodEntryForm value={entry} onChange={setEntry} onEstimate={handleEstimate} estimating={estimating} />
        <PrimaryButton title="Save" onPress={handleSave} loading={saving} />
        {entryId && <PrimaryButton title="Delete" variant="secondary" onPress={handleDelete} loading={saving} />}
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
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
