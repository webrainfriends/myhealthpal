import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchAiUsage } from '../api/client';
import { useT } from '../i18n/I18nContext';
import ChipSelect from '../components/ChipSelect';

const PERIOD_OPTIONS = [7, 30, 90];

function formatTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

// Sub-cent costs are normal for a single request, so show enough precision
// to tell them apart instead of rounding everything to "$0.00".
function formatCost(value) {
  if (!value) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function StatTile({ label, value }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={typography.caption}>{label}</Text>
    </View>
  );
}

function TotalsCard({ title, totals, t }) {
  return (
    <View style={[styles.card, cardShadow]}>
      <Text style={typography.heading}>{title}</Text>
      <View style={styles.statRow}>
        <StatTile label={t('aiUsage.totalTokens')} value={formatTokens(totals.totalTokens)} />
        <StatTile label={t('aiUsage.requests')} value={String(totals.requests)} />
        <StatTile label={t('aiUsage.estimatedCost')} value={formatCost(totals.estimatedCostUsd)} />
      </View>
      <Text style={typography.caption}>
        {t('aiUsage.inputOutput', { input: formatTokens(totals.inputTokens), output: formatTokens(totals.outputTokens) })}
      </Text>
    </View>
  );
}

function BreakdownRow({ title, subtitle, totals, highlight }) {
  return (
    <View style={[styles.breakdownRow, highlight && styles.breakdownRowHighlight]}>
      <View style={styles.breakdownText}>
        <Text style={typography.body}>{title}</Text>
        {subtitle ? <Text style={typography.caption}>{subtitle}</Text> : null}
      </View>
      <View style={styles.breakdownNumbers}>
        <Text style={typography.body}>{formatTokens(totals.totalTokens)}</Text>
        <Text style={typography.caption}>{formatCost(totals.estimatedCostUsd)}</Text>
      </View>
    </View>
  );
}

// Settings > AI usage: how many Claude tokens this account has used - in
// this sign-in session, over a chosen period, and all-time - broken down by
// app feature and by session, with an estimated cost. Backed by
// GET /api/ai-usage (server/src/services/aiUsageService.js).
export default function AiUsageScreen() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSummary(await fetchAiUsage(days));
    } catch (err) {
      setError(err.message);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const featureLabel = (feature) => {
    const key = `aiUsage.features.${feature}`;
    const label = t(key);
    return label === key ? feature : label;
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={[typography.bodySecondary, styles.intro]}>{t('aiUsage.intro')}</Text>

        <ChipSelect
          options={PERIOD_OPTIONS.map((value) => ({ value, label: t('aiUsage.lastDays', { days: value }) }))}
          value={days}
          onChange={(value) => value && setDays(value)}
          allowClear={false}
        />

        {error && <Text style={styles.error}>{t('aiUsage.couldNotLoad', { message: error })}</Text>}
        {!summary && !error && <ActivityIndicator style={styles.loading} color={colors.primary} />}

        {summary && (
          <>
            <TotalsCard title={t('aiUsage.thisSession')} totals={summary.currentSession} t={t} />
            <TotalsCard title={t('aiUsage.lastDays', { days: summary.periodDays })} totals={summary.period} t={t} />
            <TotalsCard title={t('aiUsage.allTime')} totals={summary.allTime} t={t} />

            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{t('aiUsage.byFeature')}</Text>
              {summary.byFeature.length === 0 ? (
                <Text style={typography.bodySecondary}>{t('aiUsage.noUsage')}</Text>
              ) : (
                summary.byFeature.map((row) => (
                  <BreakdownRow
                    key={row.feature}
                    title={featureLabel(row.feature)}
                    subtitle={t('aiUsage.requestCount', { count: row.requests })}
                    totals={row}
                  />
                ))
              )}
            </View>

            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{t('aiUsage.bySession')}</Text>
              {summary.bySession.length === 0 ? (
                <Text style={typography.bodySecondary}>{t('aiUsage.noUsage')}</Text>
              ) : (
                summary.bySession.map((row) => (
                  <BreakdownRow
                    key={row.sessionId || 'none'}
                    title={row.isCurrent ? t('aiUsage.currentSession') : formatDateTime(row.firstUsedAt)}
                    subtitle={t('aiUsage.sessionSubtitle', {
                      count: row.requests,
                      last: formatDateTime(row.lastUsedAt),
                    })}
                    totals={row}
                    highlight={row.isCurrent}
                  />
                ))
              )}
            </View>

            <Text style={[typography.caption, styles.footnote]}>{t('aiUsage.costNote')}</Text>
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
    gap: spacing.md,
  },
  intro: {
    marginBottom: spacing.xs,
  },
  loading: {
    marginTop: spacing.lg,
  },
  error: {
    color: colors.danger,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  breakdownRowHighlight: {
    backgroundColor: colors.primaryMuted,
  },
  breakdownText: {
    flex: 1,
    gap: 2,
  },
  breakdownNumbers: {
    alignItems: 'flex-end',
    gap: 2,
  },
  footnote: {
    textAlign: 'center',
  },
});
