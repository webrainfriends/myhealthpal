import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { card3D, colors, mealTypeColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

const MEAL_ICONS = { breakfast: '🍳', lunch: '🥗', snack: '🍎', dinner: '🍝', supper: '🌙' };

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
    <TouchableOpacity style={[styles.card, card3D(mealPalette.fg)]} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.iconBubble, { backgroundColor: mealPalette.bg }]}>
        <Text style={styles.icon}>{MEAL_ICONS[entry.meal_type] || MEAL_ICONS.snack}</Text>
      </View>
      <View style={styles.main}>
        <View style={[styles.mealPill, { backgroundColor: mealPalette.bg }]}>
          <Text style={[styles.mealPillText, { color: mealPalette.fg }]}>
            {t(MEAL_LABEL_KEYS[entry.meal_type] || MEAL_LABEL_KEYS.snack)} · {formatTime(entry.consumed_at)}
          </Text>
        </View>
        <Text style={[typography.heading, styles.name]} numberOfLines={1}>
          {entry.name}
        </Text>
        <Text style={typography.bodySecondary}>{quantityLine(entry, t)}</Text>
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
      </View>
      {entry.calories != null && (
        <View style={styles.calBox}>
          <Text style={[styles.calValue, { color: mealPalette.fg }]}>{Math.round(entry.calories)}</Text>
          <Text style={styles.calUnit}>{t('diet.calSuffix').trim()}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 26 },
  main: { flex: 1, gap: 3 },
  name: {},
  mealPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  mealPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  calBox: { alignItems: 'center', minWidth: 48 },
  calValue: { fontSize: 22, fontWeight: '800' },
  calUnit: { fontSize: 11, fontWeight: '600', color: colors.textTertiary },
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
