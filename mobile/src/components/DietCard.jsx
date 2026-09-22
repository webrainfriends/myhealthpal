import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

// Compact dashboard preview of today's logged calories, the diet analog of
// ActivityCard.jsx - deliberately just a teaser (today's total + entry
// count), full detail lives on the Diet screen itself.
export default function DietCard({ today, pendingReviewCount, onPress }) {
  const t = useT();
  const hasData = today && today.calories > 0;
  const entryCount = today ? Object.values(today.meals || {}).reduce((sum, items) => sum + items.length, 0) : 0;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>🍽️</Text>
      </View>
      <View style={styles.textBlock}>
        <Text style={typography.heading}>{t('nav.diet')}</Text>
        <Text style={typography.bodySecondary} numberOfLines={2}>
          {hasData
            ? t('diet.caloriesLoggedToday', {
                calories: Math.round(today.calories),
                count: entryCount,
                plural: entryCount === 1 ? '' : 's',
              })
            : t('diet.scanOrLogToday')}
        </Text>
        {pendingReviewCount > 0 && (
          <Text style={styles.reviewNote}>
            {t('diet.itemsNeedReview', { count: pendingReviewCount, plural: pendingReviewCount === 1 ? '' : 's' })}
          </Text>
        )}
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
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 28,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  reviewNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
});
