import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/theme';
import CanonicalMappingModal from './CanonicalMappingModal';

function MappingChip({ measurement, editable, onPress }) {
  let label = 'Unmapped';
  let style = styles.chipUnmapped;
  if (measurement.ambiguous_candidate_ids) {
    label = 'Ambiguous mapping';
    style = styles.chipAmbiguous;
  } else if (measurement.parameter_display_name) {
    label = measurement.parameter_display_name;
    style = styles.chipMapped;
  }

  return (
    <TouchableOpacity style={[styles.chip, style]} onPress={editable ? onPress : undefined} disabled={!editable}>
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function MeasurementRow({ measurement, editable, onChange, onChangeMapping }) {
  const [mappingModalVisible, setMappingModalVisible] = useState(false);
  const isAbnormal = measurement.status_flag && !/normal/i.test(measurement.status_flag);
  const showsNormalized =
    measurement.normalized_value !== null &&
    measurement.normalized_unit &&
    measurement.normalized_unit !== measurement.raw_unit;

  return (
    <View style={[styles.row, measurement.needs_review && styles.needsReview]}>
      <View style={styles.headerRow}>
        {editable ? (
          <TextInput
            style={[typography.heading, styles.nameInput]}
            value={measurement.raw_test_name}
            onChangeText={(text) => onChange({ raw_test_name: text })}
          />
        ) : (
          <Text style={typography.heading}>{measurement.raw_test_name}</Text>
        )}
        {measurement.needs_review ? <Text style={styles.reviewTag}>Needs review</Text> : null}
      </View>

      <MappingChip measurement={measurement} editable={editable} onPress={() => setMappingModalVisible(true)} />

      {measurement.duplicate_status === 'suspected' ? (
        <Text style={styles.duplicateNote}>Possible duplicate of an earlier confirmed result</Text>
      ) : null}

      <View style={styles.valueRow}>
        <View style={styles.valueField}>
          <Text style={typography.caption}>VALUE</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={String(measurement.raw_value ?? '')}
              onChangeText={(text) => onChange({ raw_value: text })}
            />
          ) : (
            <Text style={typography.body}>{measurement.raw_value}</Text>
          )}
        </View>
        <View style={styles.valueField}>
          <Text style={typography.caption}>UNIT</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={measurement.raw_unit || ''}
              onChangeText={(text) => onChange({ raw_unit: text })}
            />
          ) : (
            <Text style={typography.body}>{measurement.raw_unit || '—'}</Text>
          )}
        </View>
      </View>

      {showsNormalized ? (
        <Text style={typography.caption}>
          Normalized: {measurement.normalized_value} {measurement.normalized_unit}
        </Text>
      ) : null}

      <View style={styles.valueRow}>
        <View style={styles.valueField}>
          <Text style={typography.caption}>REFERENCE RANGE</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={measurement.reference_range_raw || ''}
              onChangeText={(text) => onChange({ reference_range_raw: text })}
            />
          ) : (
            <Text style={typography.body}>{measurement.reference_range_raw || '—'}</Text>
          )}
        </View>
        <View style={styles.valueField}>
          <Text style={typography.caption}>FLAG</Text>
          {editable ? (
            <TextInput
              style={styles.input}
              value={measurement.status_flag || ''}
              onChangeText={(text) => onChange({ status_flag: text })}
            />
          ) : (
            <Text style={[typography.body, isAbnormal && styles.abnormal]}>{measurement.status_flag || '—'}</Text>
          )}
        </View>
      </View>

      <CanonicalMappingModal
        visible={mappingModalVisible}
        onClose={() => setMappingModalVisible(false)}
        onSelect={(parameterId) => onChangeMapping(parameterId)}
      />
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
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipMapped: {
    backgroundColor: colors.successMuted,
  },
  chipAmbiguous: {
    backgroundColor: colors.warningMuted,
  },
  chipUnmapped: {
    backgroundColor: colors.surfaceMuted,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  duplicateNote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.danger,
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
