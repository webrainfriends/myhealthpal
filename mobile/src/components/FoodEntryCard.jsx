import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, mealTypeColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const MEAL_LABEL_KEYS = {
  breakfast: 'diet.mealBreakfast',
  lunch: 'diet.mealLunch',
  snack: 'diet.mealSnack',
  dinner: 'diet.mealDinner',
  supper: 'diet.mealSupper',
};

function quantityLine(entry, t) {
  const parts = [];
  if (entry.quantity_amount != null && entry.quantity_unit) {
    parts.push(`${entry.quantity_amount} ${entry.quantity_unit}`);
  }
  if (entry.calories != null) parts.push(`${Math.round(entry.calories)}${t('diet.calSuffix')}`);
  return parts.join(' · ') || t(entry.needs_quantity ? 'diet.quantityNeeded' : 'diet.amountNotRecorded');
}

function formatTime(consumedAt) {
  return new Date(consumedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function FoodEntryCard({ entry, onPress }) {
  const t = useT();
  const mealPalette = mealTypeColors[entry.meal_type] || mealTypeColors.snack;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <Text style={[typography.heading, styles.name]} numberOfLines={1}>
          {entry.name}
        </Text>
        <View style={[styles.mealPill, { backgroundColor: mealPalette.bg }]}>
          <Text style={[styles.mealPillText, { color: mealPalette.fg }]}>
            {t(MEAL_LABEL_KEYS[entry.meal_type] || MEAL_LABEL_KEYS.snack)}
          </Text>
        </View>
      </View>

      <Text style={typography.bodySecondary}>{quantityLine(entry, t)}</Text>
      <Text style={typography.caption}>{formatTime(entry.consumed_at)}</Text>

      <View style={styles.badgeRow}>
        {entry.ai_verified && (
          <View style={[styles.miniPill, { backgroundColor: colors.primaryMuted }]}>
            <Text style={[styles.miniPillText, { color: colors.primary }]}>✨ {t('status.AI estimate')}</Text>
          </View>
        )}
        {(entry.needs_quantity || entry.needs_review) && (
          <View style={[styles.miniPill, { backgroundColor: colors.warningMuted }]}>
            <Text style={[styles.miniPillText, { color: colors.warning }]}>
              {t(entry.needs_quantity ? 'diet.needsQuantity' : 'measurement.needsReview')}
            </Text>
          </View>
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
    marginBottom: spacing.sm,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  mealPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  mealPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  miniPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  miniPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
