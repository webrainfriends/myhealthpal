import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import { cardShadow, colors, radii, spacing } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

// A small gradient "bowl of food" illustration - a crisp vector graphic
// rather than a flat emoji, in the same gradient-plus-highlight style as
// the water bottle graphic so the three dashboard tiles read as one family.
function BowlIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 36 36">
      <Defs>
        <LinearGradient id="plateGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFD27A" />
          <Stop offset="1" stopColor={colors.warning} />
        </LinearGradient>
        <RadialGradient id="foodGrad" cx="0.35" cy="0.3" r="0.75">
          <Stop offset="0" stopColor="#FFB25C" />
          <Stop offset="1" stopColor="#FF7A3D" />
        </RadialGradient>
      </Defs>
      <Circle cx="18" cy="18" r="16" fill="#FFFFFF" stroke="url(#plateGrad)" strokeWidth="2.5" />
      <Circle cx="18" cy="18" r="10.5" fill="url(#foodGrad)" />
      <Circle cx="14" cy="14.5" r="1.7" fill={colors.success} />
      <Circle cx="21.5" cy="13.5" r="1.4" fill="#FFE27A" />
      <Circle cx="18" cy="21.5" r="1.5" fill={colors.danger} />
    </Svg>
  );
}

// Compact dashboard tile - the diet analog of ActivityCard.jsx, sitting
// beside it in a single row rather than claiming a full-width row of its
// own. A teaser only (today's calorie total + a pending-review badge), full
// detail lives on the Diet screen itself.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <BowlIcon />
        {pendingReviewCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {pendingReviewCount}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {hasData ? Math.round(today.calories) : '—'}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {t('diet.calSuffix').trim()}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.warningMuted,
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
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '700',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.warning,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
