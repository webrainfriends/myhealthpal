import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityRings from './ActivityRings';
import { activityRingColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { formatCalendarDate } from '../utils/date';

function formatShortDate(dateStr) {
  return formatCalendarDate(dateStr, { month: 'short', day: 'numeric' }) || '';
}

// Compact dashboard preview of the most recent day's three rings -
// deliberately its own card, not part of the organ-score grid above it (see
// organHealthService.js for why activity is never scored like a lab
// result). `current` falls back to the latest logged day when nothing is
// logged for today itself (see /api/activity/summary) - a wearable export
// upload is common and rarely includes literally today, so this card
// mustn't show an empty ring just because of that lag.
export default function ActivityCard({ current, isCurrentToday, onPress }) {
  const rings = current
    ? [
        { percent: current.rings.steps, ...activityRingColors.steps },
        { percent: current.rings.exerciseMinutes, ...activityRingColors.exerciseMinutes },
        { percent: current.rings.standHours, ...activityRingColors.standHours },
      ]
    : [];
  const hasData = current?.steps || current?.exerciseMinutes || current?.standHours;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.ringsWrap}>
        <ActivityRings rings={rings} size={72} strokeWidth={8} gap={3} />
      </View>
      <View style={styles.textBlock}>
        <Text style={typography.heading}>Activity</Text>
        <Text style={typography.bodySecondary} numberOfLines={2}>
          {hasData
            ? `${current.steps ?? 0} steps · ${current.exerciseMinutes ?? 0} min exercise${
                isCurrentToday ? '' : ` · ${formatShortDate(current.date)}`
              }`
            : 'Log today’s steps and exercise'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ringsWrap: {
    width: 72,
    height: 72,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
});
