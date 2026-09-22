import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MiniTrendChart from '../components/MiniTrendChart';
import { cardShadow, colors, mealTypeColors, radii, spacing, typography } from '../theme/theme';
import { fetchDietSummary } from '../api/client';

const RANGES = [
  { key: 7, label: '7D' },
  { key: 14, label: '14D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
];

const MACRO_LABELS = [
  { key: 'protein_g', label: 'Protein', suffix: 'g' },
  { key: 'carbs_g', label: 'Carbs', suffix: 'g' },
  { key: 'fat_g', label: 'Fat', suffix: 'g' },
  { key: 'fiber_g', label: 'Fiber', suffix: 'g' },
  { key: 'sugar_g', label: 'Sugar', suffix: 'g' },
  { key: 'sodium_mg', label: 'Sodium', suffix: 'mg' },
];

const MICRONUTRIENT_LABELS = [
  { key: 'saturated_fat_g', label: 'Sat. fat', suffix: 'g' },
  { key: 'cholesterol_mg', label: 'Cholesterol', suffix: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', suffix: 'mg' },
  { key: 'calcium_mg', label: 'Calcium', suffix: 'mg' },
  { key: 'iron_mg', label: 'Iron', suffix: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', suffix: 'mcg' },
];

const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner', supper: 'Supper' };

// Averages over the days the person actually logged something, not every
// calendar day in the window - the same "logged days" denominator
// dietInsightService.js uses server-side, so this screen's numbers read
// consistently with the AI recommendation tips on the Diet tab.
function computeAverages(history) {
  const loggedDays = history.filter((d) => d.calories > 0);
  const fields = ['calories', ...MACRO_LABELS.map((m) => m.key), ...MICRONUTRIENT_LABELS.map((m) => m.key)];
  const averages = {};
  for (const field of fields) {
    averages[field] = loggedDays.length > 0 ? loggedDays.reduce((sum, d) => sum + (d[field] || 0), 0) / loggedDays.length : 0;
  }
  return { averages, loggedDayCount: loggedDays.length };
}

// Total calories logged under each meal type across the window - the
// "consuming pattern" view: where the calories actually come from, not
// just how many.
function computeMealBreakdown(history) {
  const totals = Object.fromEntries(MEAL_ORDER.map((m) => [m, 0]));
  for (const day of history) {
    for (const meal of MEAL_ORDER) {
      totals[meal] += (day.meals?.[meal] || []).reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
    }
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  return MEAL_ORDER.map((meal) => ({
    meal,
    calories: totals[meal],
    percent: grandTotal > 0 ? totals[meal] / grandTotal : 0,
  }));
}

export default function DietStatsScreen() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMicronutrients, setShowMicronutrients] = useState(false);

  const load = useCallback(async (selectedDays) => {
    setLoading(true);
    try {
      const data = await fetchDietSummary(selectedDays);
      setSummary(data);
    } catch (err) {
      console.warn('Failed to load diet stats', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const history = summary?.history || [];
  const { averages, loggedDayCount } = computeAverages(history);
  const mealBreakdown = computeMealBreakdown(history);
  const chartPoints = history.map((d) => ({ date: d.date, value: d.calories }));

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={[styles.rangeChip, days === r.key && styles.rangeChipActive]}
              onPress={() => setDays(r.key)}
            >
              <Text style={[styles.rangeChipText, days === r.key && styles.rangeChipTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && !summary ? (
          <Text style={[typography.bodySecondary, styles.empty]}>Loading…</Text>
        ) : loggedDayCount === 0 ? (
          <Text style={[typography.bodySecondary, styles.empty]}>
            Nothing logged in this window yet - your calorie/nutrient pattern will show up here once you do.
          </Text>
        ) : (
          <>
            <Text style={[typography.heading, styles.sectionHeading]}>Daily calories</Text>
            <View style={[styles.chartCard, cardShadow]}>
              <MiniTrendChart points={chartPoints} />
              <Text style={typography.caption}>
                Logged {loggedDayCount} of the last {days} day{days === 1 ? '' : 's'}
              </Text>
            </View>

            <Text style={[typography.heading, styles.sectionHeading]}>Daily average</Text>
            <View style={[styles.totalsCard, cardShadow]}>
              <Text style={styles.caloriesValue}>
                {Math.round(averages.calories)} <Text style={styles.caloriesUnit}>cal/day</Text>
              </Text>
              <View style={styles.macroGrid}>
                {MACRO_LABELS.map((m) => (
                  <View key={m.key} style={styles.macroItem}>
                    <Text style={typography.caption}>{m.label}</Text>
                    <Text style={typography.body}>
                      {Math.round(averages[m.key])}{m.suffix}
                    </Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setShowMicronutrients((s) => !s)}>
                <Text style={styles.altAction}>{showMicronutrients ? 'Hide' : 'Show'} more nutrients ▾</Text>
              </TouchableOpacity>
              {showMicronutrients && (
                <View style={styles.macroGrid}>
                  {MICRONUTRIENT_LABELS.map((m) => (
                    <View key={m.key} style={styles.macroItem}>
                      <Text style={typography.caption}>{m.label}</Text>
                      <Text style={typography.body}>
                        {Math.round(averages[m.key])}{m.suffix}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Text style={[typography.heading, styles.sectionHeading]}>Calories by meal</Text>
            <View style={[styles.mealCard, cardShadow]}>
              {mealBreakdown.map(({ meal, calories, percent }) => {
                const palette = mealTypeColors[meal];
                return (
                  <View key={meal} style={styles.mealRow}>
                    <View style={styles.mealRowHeader}>
                      <Text style={typography.body}>{MEAL_LABELS[meal]}</Text>
                      <Text style={typography.bodySecondary}>
                        {Math.round(calories)} cal · {Math.round(percent * 100)}%
                      </Text>
                    </View>
                    <View style={styles.mealBarTrack}>
                      <View style={[styles.mealBarFill, { width: `${Math.max(percent * 100, calories > 0 ? 2 : 0)}%`, backgroundColor: palette.fg }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  rangeChip: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingVertical: 6,
    alignItems: 'center',
  },
  rangeChipActive: {
    backgroundColor: colors.primary,
  },
  rangeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  rangeChipTextActive: {
    color: colors.surface,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  sectionHeading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  caloriesValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  caloriesUnit: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  macroItem: {
    minWidth: 70,
  },
  altAction: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  mealCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  mealRow: {
    gap: 4,
  },
  mealRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  mealBarTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  mealBarFill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
