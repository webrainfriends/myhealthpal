import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchBeneficiaryDashboard } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';
import { formatMoney } from '../utils/insurance';

const ATTENTION_COLORS = {
  urgent: { fg: colors.danger, bg: colors.dangerMuted },
  attention: { fg: colors.warning, bg: colors.warningMuted },
  ok: { fg: colors.success, bg: colors.successMuted },
};

const SEVERITY_COLORS = {
  critical: colors.danger,
  marked: colors.danger,
  mild: colors.warning,
};

function Pill({ label, tone }) {
  const palette = ATTENTION_COLORS[tone] || ATTENTION_COLORS.ok;
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function Section({ icon, title, error, t, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {icon} {title}
      </Text>
      {error ? <Text style={typography.caption}>{t('bdash.sectionError')}</Text> : children}
    </View>
  );
}

function dueLabel(daysLeft, t) {
  if (daysLeft < 0) return t('bdash.overdueBy', { count: Math.abs(daysLeft) });
  if (daysLeft === 0) return t('bdash.dueToday');
  return t('bdash.dueIn', { count: daysLeft });
}

function insuranceDateLabel(item, t) {
  const kind = item.kind === 'premium' ? t('bdash.premiumDue') : t('bdash.renewal');
  const when = item.daysLeft < 0 ? t('bdash.overdueDays', { count: Math.abs(item.daysLeft) }) : t('bdash.inDays', { count: item.daysLeft });
  return `${kind} · ${when} · ${formatCalendarDate(item.date, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function BeneficiaryCard({ person, t }) {
  const [open, setOpen] = useState(person.attention !== 'ok');
  const palette = ATTENTION_COLORS[person.attention];
  const { testsDue, insurance, medications, health } = person;

  return (
    <View style={[styles.card, cardShadow]}>
      <TouchableOpacity style={styles.cardHeader} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <View style={[styles.avatar, { backgroundColor: palette.bg }]}>
          <Text style={[styles.avatarText, { color: palette.fg }]}>{(person.displayName || '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={typography.heading} numberOfLines={1}>
            {person.displayName}
          </Text>
          <Text style={typography.caption}>
            {[person.relation, t(`bdash.role.${person.role}`)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pill label={t(`bdash.status.${person.attention}`)} tone={person.attention} />
      </TouchableOpacity>

      <View style={styles.chipRow}>
        {testsDue.overdueCount > 0 && <Pill tone="urgent" label={`${t('bdash.testsDue')}: ${testsDue.overdueCount} ⚠`} />}
        {testsDue.dueSoonCount > 0 && <Pill tone="attention" label={`${t('bdash.testsDue')}: ${testsDue.dueSoonCount}`} />}
        {medications.refillSoonCount > 0 && <Pill tone="attention" label={`${t('bdash.refillSoon')}: ${medications.refillSoonCount}`} />}
        {medications.missedDoseCount > 0 && <Pill tone="attention" label={t('bdash.missedDoses', { count: medications.missedDoseCount })} />}
        {medications.expiringSoonCount > 0 && <Pill tone="attention" label={`${t('bdash.expiringSoon')}: ${medications.expiringSoonCount}`} />}
        {health.outOfRangeCount > 0 && (
          <Pill tone={health.criticalCount > 0 ? 'urgent' : 'attention'} label={t('bdash.healthCount', { count: health.outOfRangeCount })} />
        )}
      </View>

      {open && (
        <>
          <Section icon="📅" title={t('bdash.testsDue')} error={testsDue.error} t={t}>
            {testsDue.items.length === 0 ? (
              <Text style={typography.caption}>{t('bdash.noTestsDue')}</Text>
            ) : (
              testsDue.items.map((item) => (
                <View key={item.id} style={styles.line}>
                  <Text style={[typography.body, styles.flex]} numberOfLines={1}>
                    {item.testName}
                  </Text>
                  <Text style={[typography.caption, item.overdue && { color: colors.danger }]}>{dueLabel(item.daysLeft, t)}</Text>
                </View>
              ))
            )}
          </Section>

          <Section icon="🛡️" title={t('bdash.insurance')} error={insurance.error} t={t}>
            {insurance.policies.length === 0 ? (
              <Text style={typography.caption}>{t('bdash.noPolicies')}</Text>
            ) : (
              insurance.policies.map((policy) => (
                <View key={policy.id} style={styles.line}>
                  <Text style={[typography.body, styles.flex]} numberOfLines={1}>
                    {policy.label}
                  </Text>
                  {policy.sumInsured ? (
                    <Text style={typography.caption}>{t('bdash.sumInsured', { amount: formatMoney(policy.sumInsured, policy.currency) })}</Text>
                  ) : null}
                </View>
              ))
            )}
            {insurance.upcoming.map((item) => (
              <Text key={`${item.kind}-${item.policyId}`} style={[typography.caption, item.overdue || item.daysLeft <= 14 ? { color: colors.danger } : null]}>
                {insuranceDateLabel(item, t)}
              </Text>
            ))}
            {insurance.gapCount > 0 && <Text style={[typography.caption, { color: colors.warning }]}>{t('bdash.gaps', { count: insurance.gapCount })}</Text>}
            {insurance.needsReviewCount > 0 && <Text style={typography.caption}>{t('bdash.needsReview', { count: insurance.needsReviewCount })}</Text>}
          </Section>

          <Section icon="💊" title={t('bdash.medications')} error={medications.error} t={t}>
            {medications.items.length === 0 ? (
              <Text style={typography.caption}>{t('bdash.noMedications')}</Text>
            ) : (
              medications.items.map((med) => (
                <View key={med.id} style={styles.medRow}>
                  <View style={styles.line}>
                    <Text style={[typography.body, styles.flex]} numberOfLines={1}>
                      {med.name}
                    </Text>
                    <Text style={typography.caption}>{[med.frequency, ...(med.timesOfDay || [])].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {med.reminder && med.reminder.active && (
                    <Text style={typography.caption}>
                      {[
                        t('bdash.dosesToday', { taken: med.reminder.takenToday, due: med.reminder.dueToday }),
                        med.reminder.dosesRemaining !== null ? t('bdash.dosesLeft', { count: med.reminder.dosesRemaining }) : null,
                        med.reminder.missedRecent > 0 ? t('bdash.missedDoses', { count: med.reminder.missedRecent }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                  {med.alerts.map((alert) => (
                    <Text key={alert.type} style={[typography.caption, { color: alert.severity === 'info' ? colors.textSecondary : colors.warning }]}>
                      {alert.title}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </Section>

          <Section icon="🩺" title={t('bdash.health')} error={health.error} t={t}>
            {health.evaluatedCount === 0 ? (
              <Text style={typography.caption}>{t('bdash.healthNoResults')}</Text>
            ) : health.outOfRangeCount === 0 ? (
              <Text style={typography.caption}>{t('bdash.healthAllInRange')}</Text>
            ) : (
              health.outOfRange.map((result) => (
                <View key={result.code} style={styles.line}>
                  <Text style={[typography.body, styles.flex]} numberOfLines={1}>
                    {result.name}
                  </Text>
                  <Text style={[styles.resultValue, { color: SEVERITY_COLORS[result.severity] || colors.warning }]}>
                    {[result.direction ? t(`bdash.${result.direction}`) : null, [result.value, result.unit].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(' ')}
                    {result.severity === 'critical' ? ` · ${t('bdash.critical')}` : ''}
                  </Text>
                </View>
              ))
            )}
            {health.latestResultDate && (
              <Text style={typography.caption}>
                {t('bdash.latestResult', { date: formatCalendarDate(health.latestResultDate, { month: 'short', day: 'numeric', year: 'numeric' }) })}
              </Text>
            )}
          </Section>
        </>
      )}
    </View>
  );
}

function Stat({ value, label, tone }) {
  return (
    <View style={[styles.stat, cardShadow]}>
      <Text style={[styles.statValue, tone && { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function BeneficiaryDashboardScreen({ navigation }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchBeneficiaryDashboard());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {!data && !error && <ActivityIndicator color={colors.primary} style={styles.loader} />}
        {error && !data && <Text style={[typography.bodySecondary, { color: colors.danger }]}>{t('bdash.couldNotLoad')}: {error}</Text>}

        {data && data.beneficiaries.length === 0 && (
          <View style={styles.empty}>
            <Text style={typography.bodySecondary}>{t('bdash.empty')}</Text>
            <PrimaryButton title={t('bdash.goToFamily')} onPress={() => navigation.navigate('Family')} variant="secondary" />
          </View>
        )}

        {data && data.beneficiaries.length > 0 && (
          <>
            <Text style={typography.bodySecondary}>{t('bdash.intro')}</Text>
            <View style={styles.statRow}>
              <Stat value={data.totals.beneficiaryCount} label={t('bdash.people')} />
              <Stat value={data.totals.needingAttention} label={t('bdash.needAttention')} tone={data.totals.needingAttention ? colors.warning : undefined} />
              <Stat value={data.totals.testsOverdue} label={t('bdash.testsOverdue')} tone={data.totals.testsOverdue ? colors.danger : undefined} />
              <Stat value={data.totals.refillsSoon} label={t('bdash.refillsSoon')} tone={data.totals.refillsSoon ? colors.warning : undefined} />
              <Stat value={data.totals.outOfRangeResults} label={t('bdash.outOfRange')} tone={data.totals.outOfRangeResults ? colors.warning : undefined} />
            </View>
            {data.beneficiaries.map((person) => (
              <BeneficiaryCard key={person.id} person={person} t={t} />
            ))}
            <Text style={[typography.caption, styles.note]}>{t('bdash.privacyNote')}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  flex: { flex: 1 },
  loader: { marginTop: spacing.xl },
  empty: { gap: spacing.md },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  statLabel: { ...typography.caption, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: { borderRadius: radii.pill ?? 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: '600' },
  section: { gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  sectionTitle: { ...typography.caption, fontWeight: '700', textTransform: 'uppercase' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  medRow: { gap: 2 },
  resultValue: { fontSize: 13, fontWeight: '600' },
  note: { textAlign: 'center' },
});
