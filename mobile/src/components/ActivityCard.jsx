import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityRings from './ActivityRings';
import GradientFill from './brand/GradientFill';
import { gradients } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

// Candy-bright ring colors for THIS card only (not the shared
// activityRingColors token, which is tuned for white backgrounds elsewhere
// like ActivityScreen) - white/yellow/sky-blue pop against the lime gradient
// instead of blending into it.
const HERO_RING_COLORS = {
  steps: { fg: '#FFFFFF', track: 'rgba(255, 255, 255, 0.28)' },
  exerciseMinutes: { fg: '#FFE27A', track: 'rgba(255, 255, 255, 0.28)' },
  standHours: { fg: '#8FE3FF', track: 'rgba(255, 255, 255, 0.28)' },
};

function formatShortDate(dateStr) {
  return formatCalendarDate(dateStr, { month: 'short', day: 'numeric' }) || '';
}

// Dashboard tile - a vibrant gradient "hero" card (matching the water
// bottle and mascot's illustrated style) rather than a flat tinted
// rectangle, with the original Apple Health-style rings restored as its
// centerpiece instead of a small icon.
export default function ActivityCard({ current, isCurrentToday, onPress }) {
  const t = useT();
  const hasData = Boolean(current?.steps || current?.exerciseMinutes || current?.standHours);
  const rings = current
    ? [
        { percent: current.rings.steps, ...HERO_RING_COLORS.steps },
        { percent: current.rings.exerciseMinutes, ...HERO_RING_COLORS.exerciseMinutes },
        { percent: current.rings.standHours, ...HERO_RING_COLORS.standHours },
      ]
    : [];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <GradientFill colors={gradients.lime} />
      <View style={[styles.bubble, styles.bubbleOne]} />
      <View style={[styles.bubble, styles.bubbleTwo]} />

      <ActivityRings rings={rings} size={52} strokeWidth={7} gap={3} />
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
    minHeight: 132,
    borderRadius: 24,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  bubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  bubbleOne: { width: 70, height: 70, top: -26, right: -22 },
  bubbleTwo: { width: 46, height: 46, bottom: -18, left: -14 },
  value: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  caption: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
  },
});
