import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { formatCalendarDate } from '../utils/date';

const SOURCE_LABELS = {
  manual: '✍️ Manual',
  imported: '📄 Imported',
  kitchen_generated: '🥘 From kitchen',
};

// One row on the Diet Schedules list - mirrors RetestPlanCard.jsx's
// composition (a leading badge, a title block, a footer actions row) since
// both are "a plan with a countdown/status" card, just diet- rather than
// retest-shaped.
export default function DietScheduleCard({ schedule, onPress, onDelete }) {
  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <View style={styles.durationBadge}>
          <Text style={styles.durationNumber}>{schedule.duration_days}</Text>
          <Text style={styles.durationUnit}>days</Text>
        </View>
        <View style={styles.titleBlock}>
          <Text style={typography.heading} numberOfLines={1}>{schedule.title}</Text>
          <Text style={typography.caption}>
            {SOURCE_LABELS[schedule.source_type] || schedule.source_type} · starts {formatCalendarDate(schedule.start_date)}
          </Text>
        </View>
      </View>
      <View style={styles.footerRow}>
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.deleteLabel}>Delete</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  durationBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryMuted,
  },
  durationNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 22,
  },
  durationUnit: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  deleteLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
  },
});
