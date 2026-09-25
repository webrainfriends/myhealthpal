import { StyleSheet, Text, TextInput, View } from 'react-native';
import ChipSelect from './ChipSelect';
import { colors, radii, spacing, typography } from '../theme/theme';

const FORM_OPTIONS = [
  'tablet',
  'capsule',
  'syrup',
  'tonic',
  'injection',
  'drops',
  'lotion',
  'inhaler',
  'cream',
  'other',
].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const DOSAGE_UNIT_OPTIONS = ['mg', 'mcg', 'g', 'ml', 'iu', 'percent', 'other'].map((v) => ({ value: v, label: v }));
const MEDICINE_SYSTEM_OPTIONS = [
  { value: 'allopathic', label: 'Allopathic (modern medicine)' },
  { value: 'ayurvedic', label: 'Ayurvedic' },
  { value: 'homeopathic', label: 'Homeopathic' },
  { value: 'unani', label: 'Unani' },
  { value: 'siddha', label: 'Siddha' },
];

function Field({ label, value, onChangeText, placeholder, keyboardType }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={keyboardType}
      />
    </View>
  );
}

// Shared editable form for a medication's fields, used both on the scan
// review screen (correcting an AI reading before confirming) and the
// medication detail screen (editing afterward) - same fields, same
// validation-by-construction via ChipSelect for the two DB enum columns.
export default function MedicationForm({ value, onChange }) {
  function set(field, fieldValue) {
    onChange({ ...value, [field]: fieldValue });
  }

  return (
    <View style={styles.container}>
      <Field label="Name" value={value.name} onChangeText={(t) => set('name', t)} placeholder="e.g. Metformin" />
      <Field
        label="Generic name"
        value={value.generic_name}
        onChangeText={(t) => set('generic_name', t)}
        placeholder="e.g. Metformin hydrochloride"
      />
      <View style={styles.row}>
        <Field
          label="Dosage amount"
          value={value.dosage_amount != null ? String(value.dosage_amount) : ''}
          onChangeText={(t) => set('dosage_amount', t)}
          placeholder="500"
          keyboardType="decimal-pad"
        />
      </View>
      <ChipSelect
        label="Dosage unit"
        options={DOSAGE_UNIT_OPTIONS}
        value={value.dosage_unit}
        onChange={(v) => set('dosage_unit', v)}
      />
      <ChipSelect label="Form" options={FORM_OPTIONS} value={value.form} onChange={(v) => set('form', v)} />
      <ChipSelect
        label="Medicine system"
        options={MEDICINE_SYSTEM_OPTIONS}
        value={value.medicine_system || 'allopathic'}
        onChange={(v) => set('medicine_system', v)}
        allowClear={false}
      />
      <Field
        label="Ingredients / composition (as printed on the label)"
        value={value.ingredients_raw}
        onChangeText={(t) => set('ingredients_raw', t)}
        placeholder="e.g. Paracetamol 500mg, Caffeine 65mg"
      />
      <Field
        label="Times per day"
        value={value.frequency_per_day != null ? String(value.frequency_per_day) : ''}
        onChangeText={(t) => set('frequency_per_day', t)}
        placeholder="2"
        keyboardType="decimal-pad"
      />
      <Field
        label="Instructions"
        value={value.instructions}
        onChangeText={(t) => set('instructions', t)}
        placeholder="e.g. after food"
      />
      <Field
        label="Prescribed for"
        value={value.prescribed_for}
        onChangeText={(t) => set('prescribed_for', t)}
        placeholder="e.g. Type 2 diabetes"
      />
      <Field
        label="Prescribing doctor"
        value={value.prescribing_doctor}
        onChangeText={(t) => set('prescribing_doctor', t)}
        placeholder="Dr. …"
      />
      <View style={styles.row}>
        <Field
          label="Start date"
          value={value.start_date ? String(value.start_date).slice(0, 10) : ''}
          onChangeText={(t) => set('start_date', t)}
          placeholder="YYYY-MM-DD"
        />
        <Field
          label="Course length (days)"
          value={value.duration_days != null ? String(value.duration_days) : ''}
          onChangeText={(t) => set('duration_days', t)}
          placeholder="90"
          keyboardType="number-pad"
        />
      </View>
      <View style={styles.row}>
        <Field
          label="Quantity dispensed"
          value={value.quantity_dispensed != null ? String(value.quantity_dispensed) : ''}
          onChangeText={(t) => set('quantity_dispensed', t)}
          placeholder="30"
          keyboardType="number-pad"
        />
        <Field
          label="Expiry date"
          value={value.expiry_date ? String(value.expiry_date).slice(0, 10) : ''}
          onChangeText={(t) => set('expiry_date', t)}
          placeholder="YYYY-MM-DD"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
});
