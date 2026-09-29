import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityRings from './ActivityRings';
import GradientFill from './brand/GradientFill';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

const ACTIVITY_IMAGE = require('../../assets/dashboard/activity-buddy.jpg');
// Transparent at the top (so the photo reads clearly) fading into a green
// tint at the bottom - keeps the step count legible without hiding the
// illustration behind a flat color block.
const OVERLAY = ['rgba(15, 185, 129, 0)', 'rgba(6, 110, 76, 0.86)'];

// Candy-bright ring colors for THIS card only (not the shared
// activityRingColors token, which is tuned for white backgrounds elsewhere
// like ActivityScreen) - white/yellow/sky-blue pop against the photo
// instead of blending into it.
const RING_COLORS = {
  steps: { fg: '#FFFFFF', track: 'rgba(255, 255, 255, 0.3)' },
  exerciseMinutes: { fg: '#FFE27A', track: 'rgba(255, 255, 255, 0.3)' },
  standHours: { fg: '#8FE3FF', track: 'rgba(255, 255, 255, 0.3)' },
};

function formatShortDate(dateStr) {
  return formatCalendarDate(dateStr, { month: 'short', day: 'numeric' }) || '';
}

// Dashboard tile - a real photo fills the card (an actual "HQ background
// image" rather than an icon or illustration), tinted with the app's
// activity color so the card still reads as part of the same system. The
// Apple Health-style rings ride on top as a small badge rather than the
// whole card, so the photo stays the centerpiece.
export default function ActivityCard({ current, isCurrentToday, onPress }) {
  const t = useT();
  const hasData = Boolean(current?.steps || current?.exerciseMinutes || current?.standHours);
  const rings = current
    ? [
        { percent: current.rings.steps, ...RING_COLORS.steps },
        { percent: current.rings.exerciseMinutes, ...RING_COLORS.exerciseMinutes },
        { percent: current.rings.standHours, ...RING_COLORS.standHours },
      ]
    : [];

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={ACTIVITY_IMAGE} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <GradientFill colors={OVERLAY} angle="vertical" />

      <View style={styles.ringBadge}>
        <ActivityRings rings={rings} size={38} strokeWidth={5} gap={2} />
      </View>

      <View style={styles.textBlock}>
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
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 140,
    borderRadius: 24,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: 14,
  },
  ringBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  caption: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.75)',
  },
});
