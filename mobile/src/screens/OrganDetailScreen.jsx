import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ResultSummaryModal from '../components/ResultSummaryModal';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { fetchOrganHealth } from '../api/client';

const RESULT_STATUS_LABEL = { normal: 'Normal', abnormal: 'Out of range', unknown: 'Not evaluated' };

function formatDate(value) {
  if (!value) return 'unknown date';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ParameterRow({ parameter, onPress, onAlertPress }) {
  const palette =
    parameter.resultStatus === 'normal'
      ? healthStatusColors.good
      : parameter.resultStatus === 'abnormal'
        ? healthStatusColors.attention
        : healthStatusColors.no_data;
  const isAbnormal = parameter.resultStatus === 'abnormal';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowMain}>
        <View style={styles.rowNameLine}>
          {isAbnormal && (
            <TouchableOpacity
              onPress={(e) => {
                // Web bubbles a touch to the parent row's own onPress
                // unless stopped; native's responder system already gives
                // the inner Touchable exclusive claim on the gesture, and
                // has no stopPropagation on its event, hence the guard.
                e.stopPropagation?.();
                onAlertPress();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.alertBadge}>⚠️</Text>
            </TouchableOpacity>
          )}
          <Text style={[typography.body, styles.rowNameText]} numberOfLines={1}>
            {parameter.displayName}
          </Text>
        </View>
        <Text style={typography.caption}>{formatDate(parameter.effectiveDate)}</Text>
      </View>
      <View style={styles.rowValueBlock}>
        <Text style={typography.heading}>
          {parameter.value ?? '—'} <Text style={styles.unit}>{parameter.unit || ''}</Text>
        </Text>
        <View style={[styles.miniPill, { backgroundColor: palette.bg }]}>
          <Text style={[styles.miniPillText, { color: palette.fg }]}>
            {RESULT_STATUS_LABEL[parameter.resultStatus] || 'Not evaluated'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function OrganDetailScreen({ route, navigation }) {
  const { organKey, initialOrgan } = route.params;
  const [organ, setOrgan] = useState(initialOrgan || null);
  const [summaryParameter, setSummaryParameter] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchOrganHealth();
      const match = data.organs.find((o) => o.key === organKey);
      if (match) setOrgan(match);
    } catch (err) {
      console.warn('Failed to load organ detail', err.message);
    }
  }, [organKey]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  useEffect(() => {
    if (organ) navigation.setOptions({ title: organ.label });
  }, [navigation, organ]);

  if (!organ) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const palette = healthStatusColors[organ.status] || healthStatusColors.no_data;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, cardShadow]}>
          <View style={styles.heroTopRow}>
            <View style={[styles.iconBadge, { backgroundColor: palette.bg }]}>
              <Text style={styles.icon}>{organ.icon}</Text>
            </View>
            <View style={styles.heroScoreBlock}>
              <Text style={[styles.heroScore, { color: palette.fg }]}>
                {organ.scorePercent === null ? '—' : `${organ.scorePercent}%`}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
                <Text style={[styles.statusPillText, { color: palette.fg }]}>{organ.statusLabel}</Text>
              </View>
            </View>
          </View>
          <Text style={typography.bodySecondary}>
            {organ.trackedCount === 0
              ? `No ${organ.label.toLowerCase()} results yet — upload a report that includes these tests to start tracking.`
              : `Health Score = the share of your latest ${organ.label.toLowerCase()} results that fall in range (${organ.normalCount} of ${organ.normalCount + organ.attentionCount} evaluable results).`}
          </Text>
          <Text style={styles.disclaimer}>
            Uses the range printed on your report when there is one to read; otherwise a general WHO / ICMR / FDA-aligned
            clinical reference range. This is a summary of your own data, not a diagnosis - always discuss results with
            your doctor.
          </Text>
        </View>

        <Text style={[typography.heading, styles.sectionSpacing]}>Tracked tests</Text>
        {organ.parameters.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.emptySection]}>Nothing tracked here yet.</Text>
        ) : (
          organ.parameters.map((parameter) => (
            <ParameterRow
              key={parameter.code}
              parameter={parameter}
              onPress={() =>
                parameter.code
                  ? navigation.navigate('ParameterTrend', { code: parameter.code, displayName: parameter.displayName })
                  : undefined
              }
              onAlertPress={() => setSummaryParameter(parameter)}
            />
          ))
        )}
      </ScrollView>

      <ResultSummaryModal
        parameter={summaryParameter}
        onClose={() => setSummaryParameter(null)}
        onViewTrend={
          summaryParameter?.code
            ? () => {
                const { code, displayName } = summaryParameter;
                setSummaryParameter(null);
                navigation.navigate('ParameterTrend', { code, displayName });
              }
            : undefined
        }
      />
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
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 28,
  },
  heroScoreBlock: {
    gap: 4,
  },
  heroScore: {
    fontSize: 34,
    fontWeight: '800',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  sectionSpacing: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptySection: {
    marginTop: spacing.xs,
  },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  alertBadge: {
    fontSize: 14,
  },
  rowNameText: {
    flexShrink: 1,
  },
  rowValueBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  unit: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  miniPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  miniPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
