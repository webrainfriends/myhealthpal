import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

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
        <Text style={styles.icon}>🍽️</Text>
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
  icon: {
    fontSize: 18,
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
