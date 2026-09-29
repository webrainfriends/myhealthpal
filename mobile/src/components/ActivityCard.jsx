import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

function formatShortDate(dateStr) {
  return formatCalendarDate(dateStr, { month: 'short', day: 'numeric' }) || '';
}

// Compact dashboard tile - sits beside DietCard and WaterBottleTracker in a
// single row instead of stacking full-width, so `current` (today's steps, or
// the latest logged day - see /api/activity/summary) reduces to just the
// headline number rather than the full ring breakdown.
export default function ActivityCard({ current, isCurrentToday, onPress }) {
  const t = useT();
  const hasData = Boolean(current?.steps || current?.exerciseMinutes || current?.standHours);

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>🔥</Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {hasData ? current.steps ?? 0 : '—'}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {t('activity.stepsLabel')}
      </Text>
      {hasData && !isCurrentToday && (
        <Text style={styles.caption} numberOfLines={1}>
          {formatShortDate(current.date)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.successMuted,
    borderRadius: radii.lg,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  icon: {
    fontSize: 18,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.success,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textTertiary,
  },
});
