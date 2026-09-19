import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/theme';

const CHART_HEIGHT = 56;
const MIN_BAR_HEIGHT = 4;

// A dependency-free sparkline: good enough to show direction/shape of a
// trend inline without pulling in a charting library for a light-themed,
// mostly-sparse (lab result) data shape.
export default function MiniTrendChart({ points }) {
  const values = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) {
    return <Text style={styles.empty}>Not enough numeric data to chart.</Text>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return (
    <View style={styles.container}>
      {points.map((point, index) => {
        const hasValue = point.value !== null && point.value !== undefined;
        const height = hasValue ? MIN_BAR_HEIGHT + ((point.value - min) / range) * (CHART_HEIGHT - MIN_BAR_HEIGHT) : MIN_BAR_HEIGHT;
        return (
          <View key={`${point.date}-${index}`} style={styles.barColumn}>
            <View style={[styles.bar, { height }, !hasValue && styles.barMissing]} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: 3,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: CHART_HEIGHT,
  },
  bar: {
    width: '100%',
    maxWidth: 10,
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  barMissing: {
    backgroundColor: colors.border,
  },
  empty: {
    color: colors.textTertiary,
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
});
