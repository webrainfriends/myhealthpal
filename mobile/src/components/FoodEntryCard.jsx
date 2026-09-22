import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, mealTypeColors, radii, spacing, typography } from '../theme/theme';

const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner', supper: 'Supper' };

function quantityLine(entry) {
  const parts = [];
  if (entry.quantity_amount != null && entry.quantity_unit) {
    parts.push(`${entry.quantity_amount} ${entry.quantity_unit}`);
  }
  if (entry.calories != null) parts.push(`${Math.round(entry.calories)} cal`);
  return parts.join(' · ') || (entry.needs_quantity ? 'Quantity needed' : 'Amount not recorded');
}

function formatTime(consumedAt) {
  return new Date(consumedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function FoodEntryCard({ entry, onPress }) {
  const mealPalette = mealTypeColors[entry.meal_type] || mealTypeColors.snack;

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <Text style={[typography.heading, styles.name]} numberOfLines={1}>
          {entry.name}
        </Text>
        <View style={[styles.mealPill, { backgroundColor: mealPalette.bg }]}>
          <Text style={[styles.mealPillText, { color: mealPalette.fg }]}>{MEAL_LABELS[entry.meal_type]}</Text>
        </View>
      </View>

      <Text style={typography.bodySecondary}>{quantityLine(entry)}</Text>
      <Text style={typography.caption}>{formatTime(entry.consumed_at)}</Text>

      <View style={styles.badgeRow}>
        {entry.ai_verified && (
          <View style={[styles.miniPill, { backgroundColor: colors.primaryMuted }]}>
            <Text style={[styles.miniPillText, { color: colors.primary }]}>✨ AI estimate</Text>
          </View>
        )}
        {(entry.needs_quantity || entry.needs_review) && (
          <View style={[styles.miniPill, { backgroundColor: colors.warningMuted }]}>
            <Text style={[styles.miniPillText, { color: colors.warning }]}>
              {entry.needs_quantity ? 'Needs quantity' : 'Needs review'}
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
