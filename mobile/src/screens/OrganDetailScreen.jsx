import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ResultSummaryModal from '../components/ResultSummaryModal';
import SpeakButton from '../components/SpeakButton';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { fetchCustomCards, fetchOrganHealth } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

const RESULT_STATUS_KEYS = {
  normal: 'organDetail.resultNormal',
  abnormal: 'organDetail.resultAbnormal',
  unknown: 'organDetail.resultUnevaluated',
};

function formatDate(value) {
  if (!value) return 'unknown date';
  return formatCalendarDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Builds the sentence SpeakButton reads for the whole organ card: each
// tracked test's name, value, and whether it's in range - the same data
// ParameterRow shows below, said aloud instead.
function buildOrganSpeech(organ, t) {
  const parts = organ.parameters.map((p) => {
    const value = p.value !== null && p.value !== undefined ? `${p.value} ${p.unit || ''}` : '';
    return `${p.displayName}: ${value}, ${t(RESULT_STATUS_KEYS[p.resultStatus] || RESULT_STATUS_KEYS.unknown)}.`;
  });
  return parts.join(' ');
}

function ParameterRow({ parameter, onPress, onAlertPress, t }) {
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
            {t(RESULT_STATUS_KEYS[parameter.resultStatus] || RESULT_STATUS_KEYS.unknown)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const STATUS_LABEL_KEYS = {
  good: 'organDetail.statusGood',
  watch: 'organDetail.statusWatch',
  attention: 'organDetail.statusAttention',
  no_data: 'organDetail.statusNoData',
};

export default function OrganDetailScreen({ route, navigation }) {
  const { organKey, initialOrgan, source } = route.params;
  const t = useT();
  const [organ, setOrgan] = useState(initialOrgan || null);
  const [summaryParameter, setSummaryParameter] = useState(null);
  // Custom (AI/heuristic-grouped) cards cover results with no registry
  // match at all - see /api/dashboard/custom-cards - and share this same
  // detail layout, just sourced from a different endpoint keyed the same
  // way (organ.key / card.key).
  const isCustom = source === 'custom';

  const load = useCallback(async () => {
    try {
      const data = isCustom ? await fetchCustomCards() : await fetchOrganHealth();
      const list = isCustom ? data.cards : data.organs;
      const match = list.find((o) => o.key === organKey);
      if (match) setOrgan(match);
    } catch (err) {
      console.warn('Failed to load organ detail', err.message);
    }
  }, [organKey, isCustom]);

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
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('organDetail.loading')}</Text>
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
                <Text style={[styles.statusPillText, { color: palette.fg }]}>
                  {t(STATUS_LABEL_KEYS[organ.status] || STATUS_LABEL_KEYS.no_data)}
                </Text>
              </View>
            </View>
            <SpeakButton text={buildOrganSpeech(organ, t)} label={t('organDetail.readAloud')} />
          </View>
          <Text style={typography.bodySecondary}>
            {organ.trackedCount === 0
              ? t('organDetail.noResultsYet', { organ: organ.label.toLowerCase() })
              : t('organDetail.healthScoreDescription', {
                  organ: organ.label.toLowerCase(),
                  normal: organ.normalCount,
                  total: organ.normalCount + organ.attentionCount,
                })}
          </Text>
          <Text style={styles.disclaimer}>{t('organDetail.disclaimer')}</Text>
        </View>

        {organ.suggestedTests?.length > 0 && (
          <View style={[styles.suggestedBox, cardShadow]}>
            <Text style={typography.heading}>{t('organDetail.testsFeedCard')}</Text>
            <Text style={typography.bodySecondary}>{t('organDetail.testsFeedCardHint')}</Text>
            <View style={styles.suggestedChipRow}>
              {organ.suggestedTests.map((test) => (
                <View key={test} style={styles.suggestedChip}>
                  <Text style={styles.suggestedChipText}>{test}</Text>
                </View>
              ))}
            </View>
            {organ.note && <Text style={styles.disclaimer}>{organ.note}</Text>}
          </View>
        )}

        <Text style={[typography.heading, styles.sectionSpacing]}>{t('organDetail.trackedTests')}</Text>
        {organ.parameters.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.emptySection]}>{t('organDetail.emptyTracked')}</Text>
        ) : (
          organ.parameters.map((parameter) => (
            <ParameterRow
              key={parameter.code || parameter.displayName}
              parameter={parameter}
              t={t}
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
  suggestedBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  suggestedChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  suggestedChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  suggestedChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
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
