import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityRings from './ActivityRings';
import GradientFill from './brand/GradientFill';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

const ACTIVITY_IMAGE = require('../../assets/dashboard/activity-buddy.jpg');
// A light, mostly-transparent green wash - just enough to tie the photo
// into the app's color system without hiding the character it's a photo of.
const OVERLAY = ['rgba(15, 185, 129, 0)', 'rgba(6, 110, 76, 0.3)'];

// Candy-bright ring colors for THIS card only (not the shared
// activityRingColors token, which is tuned for white backgrounds elsewhere
// like ActivityScreen) - white/yellow/sky-blue pop against the photo
// instead of blending into it.
const RING_COLORS = {
  steps: { fg: '#FFFFFF', track: 'rgba(255, 255, 255, 0.3)' },
  exerciseMinutes: { fg: '#FFE27A', track: 'rgba(255, 255, 255, 0.3)' },
  standHours: { fg: '#8FE3FF', track: 'rgba(255, 255, 255, 0.3)' },
};

const RING_SIZE = 48;

function formatShortDate(dateStr) {
  return formatCalendarDate(dateStr, { month: 'short', day: 'numeric' }) || '';
}

// Dashboard tile - a real photo fills the card (an actual "HQ background
// image" rather than an icon or illustration), lightly tinted so the
// character it shows stays clearly visible. The Apple Health-style rings
// sit in their own glossy 3D circular badge over the photo, the same
// treatment DietCard gives its calorie count.
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

      <View style={styles.badgeGloss}>
        <ActivityRings rings={rings} size={RING_SIZE} strokeWidth={6} gap={2} />
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
    justifyContent: 'space-between',
    padding: 10,
  },
  badgeGloss: {
    alignSelf: 'flex-end',
    width: RING_SIZE + 14,
    height: RING_SIZE + 14,
    borderRadius: (RING_SIZE + 14) / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#04331F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  textBlock: {
    gap: 2,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.92)',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  caption: {
    fontSize: 10,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.85)',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
