import { StyleSheet, Text, TextInput, View } from 'react-native';
import ChipSelect from './ChipSelect';
import { colors, radii, spacing, typography } from '../theme/theme';

const QUANTITY_UNIT_OPTIONS = ['g', 'ml', 'serving', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other'].map((v) => ({
  value: v,
  label: v,
}));
const MEAL_TYPE_OPTIONS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snack', label: 'Snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'supper', label: 'Supper' },
];

// "YYYY-MM-DDTHH:MM" with no timezone suffix is unambiguously parsed as
// local time by the JS Date spec (unlike a space-separated variant, whose
// parsing isn't guaranteed across engines) - used as this field's plain-text
// format, the same free-text-date convention MedicationForm.jsx uses for
// start_date/expiry_date.
function toLocalInput(consumedAt) {
  if (!consumedAt) return '';
  const d = new Date(consumedAt);
  // Not (yet) a parseable instant - most often the user mid-typing an
  // incomplete value (see setConsumedAt below) - show it back unchanged
  // rather than clearing the field out from under them.
  if (Number.isNaN(d.getTime())) return String(consumedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Mirrors server/src/diet/dietScanService.js's classifyMealType bands -
// duplicated here (rather than shared) since mobile and server are
// separate packages/bundles. Used only to auto-fill meal_type when the
// time field changes to a valid instant; the server re-derives/validates
// independently on save regardless, so drift between the two copies is
// harmless.
function classifyMealTypeLocal(date) {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  if (minuteOfDay >= 4 * 60 && minuteOfDay < 11 * 60) return 'breakfast';
  if (minuteOfDay >= 11 * 60 && minuteOfDay < 16 * 60) return 'lunch';
  if (minuteOfDay >= 16 * 60 && minuteOfDay < 18 * 60) return 'snack';
  if (minuteOfDay >= 18 * 60 && minuteOfDay < 21 * 60 + 30) return 'dinner';
  if (minuteOfDay >= 21 * 60 + 30) return 'supper';
  return 'snack';
}

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseLocalInput(text) {
  const match = LOCAL_INPUT_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

// Shared editable form for a food entry's fields, used both on the scan
// review screen (filling in what the photo couldn't confidently size) and
// the manual add/edit screen - same fields, same ChipSelect-backed enum
// columns as MedicationForm.jsx's equivalent pattern.
export default function FoodEntryForm({ value, onChange }) {
  function set(field, fieldValue) {
    onChange({ ...value, [field]: fieldValue });
  }

  function setConsumedAt(text) {
    const parsed = parseLocalInput(text);
    if (parsed) {
      onChange({ ...value, consumed_at: parsed.toISOString(), meal_type: classifyMealTypeLocal(parsed) });
    } else {
      // Mid-typing an incomplete time - keep it editable without touching
      // meal_type or consumed_at until it parses to a real instant.
      onChange({ ...value, consumed_at: text });
    }
  }

  return (
    <View style={styles.container}>
      <Field label="Name" value={value.name} onChangeText={(t) => set('name', t)} placeholder="e.g. Grilled chicken breast" />
      <Field label="Brand (optional)" value={value.brand} onChangeText={(t) => set('brand', t)} placeholder="e.g. Amul" />

      {value.needs_quantity && (
        <Text style={styles.hint}>The photo couldn't confidently judge the portion - enter it below.</Text>
      )}
      <View style={styles.row}>
        <Field
          label="Quantity"
          value={value.quantity_amount != null ? String(value.quantity_amount) : ''}
          onChangeText={(t) => set('quantity_amount', t)}
          placeholder="1"
          keyboardType="decimal-pad"
        />
      </View>
      <ChipSelect
        label="Unit"
        options={QUANTITY_UNIT_OPTIONS}
        value={value.quantity_unit}
        onChange={(v) => set('quantity_unit', v)}
      />

      <View style={styles.row}>
        <Field
          label="Calories"
          value={value.calories != null ? String(value.calories) : ''}
          onChangeText={(t) => set('calories', t)}
          placeholder="250"
          keyboardType="decimal-pad"
        />
        <Field
          label="Sodium (mg)"
          value={value.sodium_mg != null ? String(value.sodium_mg) : ''}
          onChangeText={(t) => set('sodium_mg', t)}
          placeholder="400"
          keyboardType="decimal-pad"
        />
      </View>
      <View style={styles.row}>
        <Field
          label="Protein (g)"
          value={value.protein_g != null ? String(value.protein_g) : ''}
          onChangeText={(t) => set('protein_g', t)}
          placeholder="20"
          keyboardType="decimal-pad"
        />
        <Field
          label="Carbs (g)"
          value={value.carbs_g != null ? String(value.carbs_g) : ''}
          onChangeText={(t) => set('carbs_g', t)}
          placeholder="30"
          keyboardType="decimal-pad"
        />
      </View>
      <View style={styles.row}>
        <Field
          label="Fat (g)"
          value={value.fat_g != null ? String(value.fat_g) : ''}
          onChangeText={(t) => set('fat_g', t)}
          placeholder="10"
          keyboardType="decimal-pad"
        />
        <Field
          label="Sugar (g)"
          value={value.sugar_g != null ? String(value.sugar_g) : ''}
          onChangeText={(t) => set('sugar_g', t)}
          placeholder="5"
          keyboardType="decimal-pad"
        />
      </View>
      <Field
        label="Fiber (g)"
        value={value.fiber_g != null ? String(value.fiber_g) : ''}
        onChangeText={(t) => set('fiber_g', t)}
        placeholder="4"
        keyboardType="decimal-pad"
      />

      <Field
        label="Consumed at (YYYY-MM-DDTHH:MM)"
        value={toLocalInput(value.consumed_at)}
        onChangeText={setConsumedAt}
        placeholder="2026-06-15T08:30"
      />
      <ChipSelect
        label="Meal (auto-set from the time above - tap to override)"
        options={MEAL_TYPE_OPTIONS}
        value={value.meal_type}
        onChange={(v) => set('meal_type', v)}
        allowClear={false}
      />
      <Field label="Notes" value={value.notes} onChangeText={(t) => set('notes', t)} placeholder="Optional" />
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
  hint: {
    ...typography.caption,
    color: colors.warning,
  },
});
