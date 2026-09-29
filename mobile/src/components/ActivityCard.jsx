import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { cardShadow, colors, radii, spacing } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

// A small gradient "energy bolt" glyph - a crisp vector illustration rather
// than a flat emoji, in the same gradient-plus-highlight style as the
// water bottle graphic so the three dashboard tiles read as one family.
function BoltIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7CF0A8" />
          <Stop offset="1" stopColor={colors.success} />
        </LinearGradient>
      </Defs>
      <Path
        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        fill="url(#boltGrad)"
        stroke="#FFFFFF"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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
        <BoltIcon />
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
