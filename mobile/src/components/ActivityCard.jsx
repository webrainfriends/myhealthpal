import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityRings from './ActivityRings';
import { activityRingColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';

// Compact dashboard preview of today's three rings - deliberately its own
// card, not part of the organ-score grid above it (see organHealthService.js
// for why activity is never scored like a lab result).
export default function ActivityCard({ today, onPress }) {
  const rings = today
    ? [
        { percent: today.rings.steps, ...activityRingColors.steps },
        { percent: today.rings.exerciseMinutes, ...activityRingColors.exerciseMinutes },
        { percent: today.rings.standHours, ...activityRingColors.standHours },
      ]
    : [];

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.ringsWrap}>
        <ActivityRings rings={rings} size={72} strokeWidth={8} gap={3} />
      </View>
      <View style={styles.textBlock}>
        <Text style={typography.heading}>Activity</Text>
        <Text style={typography.bodySecondary} numberOfLines={2}>
          {today?.steps || today?.exerciseMinutes || today?.standHours
            ? `${today.steps ?? 0} steps · ${today.exerciseMinutes ?? 0} min exercise`
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
