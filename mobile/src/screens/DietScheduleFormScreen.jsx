import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import MultiChipSelect from '../components/MultiChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import {
  createManualDietSchedule,
  fetchDietScheduleImport,
  generateDietScheduleFromKitchen,
  importDietSchedule,
} from '../api/client';
import { showAlert } from '../utils/alert';

const MODE_OPTIONS = [
  { value: 'manual', label: 'Type it in' },
  { value: 'import', label: 'Import a document' },
  { value: 'kitchen', label: 'From my kitchen' },
];
const DURATION_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 15, label: '15 days' },
];
const MEAL_TYPE_OPTIONS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snack', label: 'Snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'supper', label: 'Supper' },
];
const IMPORT_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Creates a diet schedule via any of the three paths (requirement 1: manual
// or import) plus the mini-kitchen path (requirement 3). All three end at
// the same place - DietScheduleDetail - once a real schedule exists.
export default function DietScheduleFormScreen({ navigation, route }) {
  const [mode, setMode] = useState(route.params?.initialMode || 'manual');
  const [title, setTitle] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [startDate, setStartDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // 'uploading' | 'processing' | null

  // Manual mode state
  const [entries, setEntries] = useState([]);
  const [draftDay, setDraftDay] = useState('1');
  const [draftMeal, setDraftMeal] = useState('breakfast');
  const [draftDish, setDraftDish] = useState('');

  // Kitchen mode state
  const kitchenItemIds = route.params?.kitchenItemIds || [];
  const [mealTypesPerDay, setMealTypesPerDay] = useState(['breakfast', 'lunch', 'dinner']);

  function addEntry() {
    const dayNumber = Number.parseInt(draftDay, 10);
    if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > durationDays) {
      showAlert('Invalid day', `Day must be between 1 and ${durationDays}.`);
      return;
    }
    if (!draftDish.trim()) {
      showAlert('Dish name required', 'Enter what you plan to eat for this meal.');
      return;
    }
    setEntries((prev) => [...prev, { dayNumber, mealType: draftMeal, dishName: draftDish.trim() }]);
    setDraftDish('');
  }

  function removeEntry(index) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateManual() {
    if (entries.length === 0) {
      showAlert('Add at least one meal', 'Add a meal for at least one day before creating the schedule.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await createManualDietSchedule({ title, durationDays, startDate, entries });
      navigation.replace('DietScheduleDetail', { scheduleId: data.schedule.id });
    } catch (err) {
      showAlert('Could not create schedule', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function pollImport(importId) {
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const data = await fetchDietScheduleImport(importId);
      if (data.scheduleId) return { scheduleId: data.scheduleId };
      if (data.import.ingestionStatus === 'Failed') return { error: data.import.processingError };
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { error: 'This is taking longer than expected - check back on the schedule list shortly.' };
  }

  async function handlePickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME_TYPES, copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];

    setImportStatus('uploading');
    try {
      const uploaded = await importDietSchedule(
        { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file },
        { durationDays, startDate }
      );
      setImportStatus('processing');
      const outcome = await pollImport(uploaded.import.id);
      if (outcome.scheduleId) {
        navigation.replace('DietScheduleDetail', { scheduleId: outcome.scheduleId });
      } else {
        showAlert('Could not read this document', outcome.error || 'Try a clearer document, or create the schedule manually.');
      }
    } catch (err) {
      showAlert('Import failed', err.message);
    } finally {
      setImportStatus(null);
    }
  }

  async function handleGenerateFromKitchen() {
    if (kitchenItemIds.length === 0) {
      navigation.navigate('Kitchen');
      return;
    }
    setSubmitting(true);
    try {
      const data = await generateDietScheduleFromKitchen({
        title, durationDays, startDate, kitchenItemIds, mealTypesPerDay,
      });
      navigation.replace('DietScheduleDetail', { scheduleId: data.schedule.id });
    } catch (err) {
      showAlert('Could not generate schedule', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>New diet schedule</Text>

        <ChipSelect label="How would you like to create it?" options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v || 'manual')} allowClear={false} />

        <View>
          <Text style={styles.label}>Title (optional)</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Low-sodium week" placeholderTextColor={colors.textTertiary} />
        </View>

        <ChipSelect label="Duration" options={DURATION_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} value={String(durationDays)} onChange={(v) => setDurationDays(Number(v) || 7)} allowClear={false} />

        <View>
          <Text style={styles.label}>Start date</Text>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} />
        </View>

        {mode === 'manual' && (
          <View style={styles.section}>
            <Text style={typography.heading}>Add meals</Text>
            <View style={styles.addEntryRow}>
              <TextInput style={styles.dayInput} value={draftDay} onChangeText={setDraftDay} keyboardType="number-pad" placeholder="Day" placeholderTextColor={colors.textTertiary} />
              <View style={styles.dishInputWrap}>
                <TextInput style={styles.input} value={draftDish} onChangeText={setDraftDish} placeholder="Dish name" placeholderTextColor={colors.textTertiary} onSubmitEditing={addEntry} />
              </View>
            </View>
            <ChipSelect label="Meal" options={MEAL_TYPE_OPTIONS} value={draftMeal} onChange={(v) => setDraftMeal(v || 'breakfast')} allowClear={false} />
            <PrimaryButton title="+ Add meal" variant="secondary" onPress={addEntry} />

            {entries.map((entry, index) => (
              <View key={index} style={styles.entryRow}>
                <Text style={typography.body}>Day {entry.dayNumber} · {entry.mealType} · {entry.dishName}</Text>
                <TouchableOpacity onPress={() => removeEntry(index)}>
                  <Text style={styles.removeLabel}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}

            <PrimaryButton title="Create schedule" onPress={handleCreateManual} loading={submitting} disabled={submitting} />
          </View>
        )}

        {mode === 'import' && (
          <View style={styles.section}>
            <Text style={typography.bodySecondary}>
              Any format works: PDF, Word, Excel/CSV, or a photo of a written plan.
            </Text>
            {importStatus ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={typography.bodySecondary}>
                  {importStatus === 'uploading' ? 'Uploading…' : 'Reading your document…'}
                </Text>
              </View>
            ) : (
              <PrimaryButton title="Choose a file or photo" onPress={handlePickDocument} />
            )}
          </View>
        )}

        {mode === 'kitchen' && (
          <View style={styles.section}>
            {kitchenItemIds.length > 0 ? (
              <Text style={typography.bodySecondary}>Using {kitchenItemIds.length} ingredient{kitchenItemIds.length === 1 ? '' : 's'} from your kitchen.</Text>
            ) : (
              <Text style={typography.bodySecondary}>You haven't selected any kitchen ingredients yet.</Text>
            )}
            <PrimaryButton
              title={kitchenItemIds.length > 0 ? 'Change selection' : 'Select ingredients from Kitchen'}
              variant="secondary"
              onPress={() => navigation.navigate('Kitchen')}
            />
            <MultiChipSelect label="Meals per day" options={MEAL_TYPE_OPTIONS} value={mealTypesPerDay} onChange={setMealTypesPerDay} />
            <PrimaryButton
              title="Generate schedule"
              onPress={handleGenerateFromKitchen}
              loading={submitting}
              disabled={submitting || kitchenItemIds.length === 0}
            />
            <Text style={typography.caption}>Generating uses AI tokens - see Settings › AI usage.</Text>
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
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.sm,
  },
  addEntryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dayInput: {
    width: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  dishInputWrap: {
    flex: 1,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  removeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
