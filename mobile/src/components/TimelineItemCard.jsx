import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import StatusBadge from './StatusBadge';
import { colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

function formatDate(value) {
  return formatCalendarDate(value, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function TimelineItemCard({ item, onPress, onDelete }) {
  const t = useT();
  const dateLabel = item.effective_date ? formatDate(item.effective_date) : t('reportDetail.dateNeedsReview');

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.headerRow}>
        <Text style={[typography.heading, item.date_status === 'Needs Review' && styles.dateNeedsReview]}>
          {dateLabel}
        </Text>
        <View style={styles.headerRight}>
          <StatusBadge status={item.ingestion_status} />
          {onDelete && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                onDelete();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteLabel}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={typography.bodySecondary} numberOfLines={1}>
        {item.original_filename}
        {item.report_type ? ` · ${item.report_type}` : ''}
        {item.source_provider ? ` · ${item.source_provider}` : ''}
      </Text>
      <View style={styles.countsRow}>
        <Text style={typography.caption}>
          {t('timeline.parameterCount', { count: item.measurement_count, plural: item.measurement_count === 1 ? '' : 's' })}
        </Text>
        {item.abnormal_count > 0 && (
          <Text style={[typography.caption, styles.abnormalCount]}>{t('timeline.flagged', { count: item.abnormal_count })}</Text>
        )}
      </View>
      {item.likely_duplicate_of_report_id && (
        <Text style={styles.duplicateNote}>{t('timeline.likelyDuplicate')}</Text>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteButton: {
    padding: 2,
  },
  deleteLabel: {
    color: colors.textTertiary,
    fontSize: 15,
    fontWeight: '600',
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
