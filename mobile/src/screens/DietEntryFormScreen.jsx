import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FoodEntryForm from '../components/FoodEntryForm';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { createFoodEntry, deleteFoodEntry, fetchFoodEntry, updateFoodEntry } from '../api/client';
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

  useEffect(() => {
    if (!entryId) return;
    fetchFoodEntry(entryId)
      .then((data) => setEntry(data.entry))
      .catch((err) => showAlert('Could not load item', err.message));
  }, [entryId]);

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
        <FoodEntryForm value={entry} onChange={setEntry} />
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
