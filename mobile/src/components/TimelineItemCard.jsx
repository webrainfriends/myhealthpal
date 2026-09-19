import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import StatusBadge from './StatusBadge';
import { colors, radii, spacing, typography } from '../theme/theme';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function TimelineItemCard({ item, onPress }) {
  const dateLabel = item.effective_date ? formatDate(item.effective_date) : 'Date needs review';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={[typography.heading, item.date_status === 'Needs Review' && styles.dateNeedsReview]}>
          {dateLabel}
        </Text>
        <StatusBadge status={item.ingestion_status} />
      </View>
      <Text style={typography.bodySecondary} numberOfLines={1}>
        {item.original_filename}
        {item.report_type ? ` · ${item.report_type}` : ''}
        {item.source_provider ? ` · ${item.source_provider}` : ''}
      </Text>
      <View style={styles.countsRow}>
        <Text style={typography.caption}>{item.measurement_count} parameter{item.measurement_count === 1 ? '' : 's'}</Text>
        {item.abnormal_count > 0 && (
          <Text style={[typography.caption, styles.abnormalCount]}>{item.abnormal_count} flagged</Text>
        )}
      </View>
      {item.likely_duplicate_of_report_id && (
        <Text style={styles.duplicateNote}>Likely a re-upload of an earlier report</Text>
      )}
      {item.narrative_summary && (
        <Text style={[typography.bodySecondary, styles.summary]} numberOfLines={3}>
          {item.narrative_summary}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateNeedsReview: {
    color: colors.warning,
  },
  countsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  abnormalCount: {
    color: colors.danger,
    fontWeight: '600',
  },
  duplicateNote: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textTertiary,
  },
  summary: {
    marginTop: spacing.xs,
  },
});
