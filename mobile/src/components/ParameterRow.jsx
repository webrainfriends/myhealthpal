import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';

export default function ParameterRow({ parameter, editable, onChange }) {
  const isAbnormal = parameter.status_flag && !/normal/i.test(parameter.status_flag);

  return (
    <View style={[styles.row, parameter.needs_review && styles.needsReview]}>
      <View style={styles.headerRow}>
        {editable ? (
          <TextInput
            style={[typography.heading, styles.nameInput]}
            value={parameter.test_name}
            onChangeText={(text) => onChange({ test_name: text })}
          />
        ) : (
          <Text style={typography.heading}>{parameter.test_name}</Text>
        )}
        {parameter.needs_review ? <Text style={styles.reviewTag}>Needs review</Text> : null}
      </View>

      <View style={styles.valueRow}>
        <View style={styles.valueField}>
          <Text style={typography.caption}>VALUE</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={String(parameter.value ?? '')}
              onChangeText={(text) => onChange({ value: text })}
              keyboardType="default"
            />
          ) : (
            <Text style={typography.body}>{parameter.value}</Text>
          )}
        </View>
        <View style={styles.valueField}>
          <Text style={typography.caption}>UNIT</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={parameter.unit || ''}
              onChangeText={(text) => onChange({ unit: text })}
            />
          ) : (
            <Text style={typography.body}>{parameter.unit || '—'}</Text>
          )}
        </View>
      </View>

      <View style={styles.valueRow}>
        <View style={styles.valueField}>
          <Text style={typography.caption}>REFERENCE RANGE</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={parameter.reference_range || ''}
              onChangeText={(text) => onChange({ reference_range: text })}
            />
          ) : (
            <Text style={typography.body}>{parameter.reference_range || '—'}</Text>
          )}
        </View>
        <View style={styles.valueField}>
          <Text style={typography.caption}>FLAG</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={parameter.status_flag || ''}
              onChangeText={(text) => onChange({ status_flag: text })}
            />
          ) : (
            <Text style={[typography.body, isAbnormal && styles.abnormal]}>{parameter.status_flag || '—'}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  needsReview: {
    borderColor: colors.warning,
    backgroundColor: colors.warningMuted,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
    padding: 0,
  },
  reviewTag: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
  },
  valueRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueField: {
    flex: 1,
    gap: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  abnormal: {
    color: colors.danger,
    fontWeight: '600',
  },
});
