import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MiniTrendChart from '../components/MiniTrendChart';
import { colors, radii, spacing, typography } from '../theme/theme';
import { fetchParameterTrend } from '../api/client';
import { formatCalendarDate } from '../utils/date';

const RANGES = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' },
];

function formatDate(value) {
  return formatCalendarDate(value, { month: 'short', day: 'numeric', year: '2-digit' });
}

export default function ParameterTrendScreen({ route, navigation }) {
  const { code, displayName } = route.params;
  const [range, setRange] = useState('90d');
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchParameterTrend(code, range);
      setData(result);
    } catch (err) {
      console.warn('Failed to load trend', err.message);
    }
  }, [code, range]);

  useEffect(() => {
    navigation.setOptions({ title: displayName || 'Trend' });
  }, [navigation, displayName]);

  useEffect(() => {
    load();
  }, [load]);

  const points = data?.points || [];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.key}
            style={[styles.rangeChip, range === r.key && styles.rangeChipActive]}
            onPress={() => setRange(r.key)}
          >
            <Text style={[styles.rangeChipText, range === r.key && styles.rangeChipTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {points.length > 0 ? (
        <View style={styles.chartCard}>
          <MiniTrendChart points={points} />
          {data.aggregated && (
            <Text style={typography.caption}>Weekly averages shown — {points.length} buckets from dense source data.</Text>
          )}
        </View>
      ) : (
        <Text style={[typography.bodySecondary, styles.empty]}>No confirmed results in this range yet.</Text>
      )}

      <FlatList
        data={[...points].reverse()}
        keyExtractor={(item, index) => `${item.date}-${index}`}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            disabled={!item.reportId}
            onPress={() => item.reportId && navigation.navigate('ReportDetail', { reportId: item.reportId })}
          >
            <View>
              <Text style={typography.body}>
                {item.value !== null && item.value !== undefined ? `${item.value} ${item.unit || ''}` : item.qualitativeValue}
              </Text>
              <Text style={typography.caption}>
                {formatDate(item.date)} {item.reportFilename ? `· ${item.reportFilename}` : ''}
              </Text>
            </View>
            {item.referenceRange && <Text style={typography.caption}>Ref: {item.referenceRange}</Text>}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  rangeRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
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
  chartCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    margin: spacing.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
