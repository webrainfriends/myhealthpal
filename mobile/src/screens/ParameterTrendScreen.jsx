import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MiniTrendChart from '../components/MiniTrendChart';
import { colors, radii, spacing, typography } from '../theme/theme';
import { fetchParameterTrend } from '../api/client';
import { useT } from '../i18n/I18nContext';
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
  const t = useT();
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
    navigation.setOptions({ title: displayName || t('nav.trend') });
  }, [navigation, displayName, t]);

  useEffect(() => {
    load();
  }, [load]);

  const points = data?.points || [];
  // Latest report first; the API returns oldest-first for the chart.
  const listPoints = [...points].sort((a, b) => new Date(b.date) - new Date(a.date));

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
            <Text style={typography.caption}>{t('parameterTrend.weeklyAverages', { count: points.length })}</Text>
          )}
        </View>
      ) : (
        <Text style={[typography.bodySecondary, styles.empty]}>{t('parameterTrend.empty')}</Text>
      )}

      <FlatList
        data={listPoints}
        keyExtractor={(item, index) => `${item.date}-${index}`}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.row,
              item.outOfRange && (item.isLatest ? styles.rowOutLatest : styles.rowOutPast),
            ]}
            disabled={!item.reportId}
            onPress={() => item.reportId && navigation.navigate('ReportDetail', { reportId: item.reportId })}
          >
            <View style={styles.rowMain}>
              <Text style={typography.body}>
                {item.value !== null && item.value !== undefined ? `${item.value} ${item.unit || ''}` : item.qualitativeValue}
                {item.outOfRange ? (item.direction === 'high' ? ' ↑' : item.direction === 'low' ? ' ↓' : '') : ''}
              </Text>
              {item.outOfRange ? (
                <Text style={item.isLatest ? styles.tagLatest : styles.tagPast}>
                  {item.isLatest ? t('parameterTrend.outOfRangeNow') : t('parameterTrend.outOfRangePast')}
                </Text>
              ) : null}
              <Text style={typography.caption}>{formatDate(item.date)}</Text>
              {item.reportFilename ? (
                <Text style={typography.caption} numberOfLines={1} ellipsizeMode="middle">
                  {item.reportFilename}
                </Text>
              ) : null}
            </View>
            {item.referenceRange && (
              <Text style={[typography.caption, styles.rowRef]} numberOfLines={2}>{t('parameterTrend.ref', { range: item.referenceRange })}</Text>
            )}
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
    gap: spacing.sm,
  },
  // The newest result is the live status (red); earlier out-of-range results
  // stay visible as history but muted, so they read as "was", not "is".
  rowOutLatest: { borderColor: colors.danger, backgroundColor: colors.dangerMuted },
  rowOutPast: { borderColor: '#E0B45A', backgroundColor: '#FFF7E6', opacity: 0.85 },
  tagLatest: { fontSize: 12, fontWeight: '700', color: colors.danger },
  tagPast: { fontSize: 12, fontWeight: '600', color: '#9A6B00' },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowRef: {
    flexShrink: 0,
    maxWidth: '40%',
    textAlign: 'right',
  },
});
