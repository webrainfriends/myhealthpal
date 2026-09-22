import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MedicationForm from '../components/MedicationForm';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing } from '../theme/theme';
import { createMedication } from '../api/client';
import { showAlert } from '../utils/alert';

const EMPTY = {
  name: '',
  generic_name: null,
  dosage_amount: null,
  dosage_unit: null,
  form: null,
  ingredients_raw: null,
  frequency_per_day: null,
  instructions: null,
  prescribed_for: null,
  prescribing_doctor: null,
  start_date: null,
  duration_days: null,
  quantity_dispensed: null,
  expiry_date: null,
};

export default function MedicationCreateScreen({ navigation }) {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!draft.name || !draft.name.trim()) {
      showAlert('Name required', 'Enter a medication name before saving.');
      return;
    }
    setBusy(true);
    try {
      const data = await createMedication({
        ...draft,
        dosage_amount: draft.dosage_amount === '' ? null : draft.dosage_amount,
        frequency_per_day: draft.frequency_per_day === '' ? null : draft.frequency_per_day,
        duration_days: draft.duration_days === '' ? null : draft.duration_days,
        quantity_dispensed: draft.quantity_dispensed === '' ? null : draft.quantity_dispensed,
      });
      navigation.replace('MedicationDetail', { medicationId: data.medication.id });
    } catch (err) {
      showAlert('Could not save medication', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MedicationForm value={draft} onChange={setDraft} />
        <PrimaryButton title="Save medication" onPress={handleSave} loading={busy} />
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
});
