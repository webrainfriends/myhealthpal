import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import CoverageBadge from '../components/CoverageBadge';
import CoverageClauseModal from '../components/CoverageClauseModal';
import PolicyPeriodBar from '../components/PolicyPeriodBar';
import PrimaryButton from '../components/PrimaryButton';
import StatusBadge from '../components/StatusBadge';
import { cardShadow, colors, coverageColors, radii, spacing, typography } from '../theme/theme';
import { fetchInsurance, updateInsuranceSettings } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';
import { callNumber, emailTo, formatMoney, shareDraft } from '../utils/insurance';

const SEVERITY_COLORS = {
  high: { fg: colors.danger, bg: colors.dangerMuted },
  medium: { fg: colors.warning, bg: colors.warningMuted },
  low: { fg: colors.primary, bg: colors.primaryMuted },
};

function dueText(item, t) {
  const date = formatCalendarDate(item.date, { month: 'short', day: 'numeric', year: 'numeric' });
  if (item.kind === 'premium') {
    const amount = item.amount ? `${formatMoney(item.amount, item.currency)} · ` : '';
    const when =
      item.daysLeft < 0
        ? t('insurance.premiumOverdue', { count: Math.abs(item.daysLeft) })
        : item.daysLeft === 0
          ? t('insurance.premiumToday')
          : t('insurance.premiumIn', { count: item.daysLeft });
    return `${amount}${when} · ${date}${item.estimated ? ` (${t('insurance.estimated')})` : ''}`;
  }
  return `${item.daysLeft === 0 ? t('insurance.renewsToday') : t('insurance.renewsIn', { count: item.daysLeft })} · ${date}`;
}

function UpcomingRow({ item, t }) {
  const urgent = item.daysLeft <= 14;
  return (
    <View style={[styles.upcomingRow, urgent && styles.upcomingRowUrgent]}>
      <Text style={styles.upcomingIcon}>{item.kind === 'premium' ? '💳' : '🔄'}</Text>
      <View style={styles.flex}>
        <Text style={typography.body} numberOfLines={1}>
          {item.kind === 'premium' ? t('insurance.premiumLabel') : t('insurance.renewalLabel')} · {item.policyName}
        </Text>
        <Text style={[typography.caption, urgent && { color: colors.danger }]}>{dueText(item, t)}</Text>
      </View>
    </View>
  );
}

function GapCard({ gap, onOpenClauses, t }) {
  const [expanded, setExpanded] = useState(false);
  const palette = SEVERITY_COLORS[gap.severity] || SEVERITY_COLORS.low;
  const contact = gap.contact;

  async function handleShare() {
    const outcome = await shareDraft(gap.draftMessage);
    if (outcome === 'copied') showAlert(t('insurance.draftCopied'), t('insurance.draftCopiedMessage'));
  }

  return (
    <View style={[styles.gapCard, cardShadow]}>
      <View style={styles.gapHeader}>
        <View style={[styles.gapIcon, { backgroundColor: palette.bg }]}>
          <Text style={styles.gapIconText}>{gap.icon}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={typography.heading}>{gap.title}</Text>
          <Text style={typography.bodySecondary}>{gap.message}</Text>
        </View>
      </View>
      <View style={styles.chipRow}>
        {gap.parameters.map((p) => (
          <View key={p.code || p.displayName} style={[styles.paramChip, { backgroundColor: palette.bg }]}>
            <Text style={[styles.paramChipText, { color: palette.fg }]}>
              {p.displayName}
              {p.direction === 'high' ? ' ▲' : p.direction === 'low' ? ' ▼' : ''}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity onPress={() => setExpanded((v) => !v)} accessibilityRole="button">
        <Text style={styles.link}>{expanded ? t('insurance.hideQuestions') : t('insurance.showQuestions')}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.questions}>
          {gap.suggestedQuestions.map((q) => (
            <Text key={q} style={typography.bodySecondary}>
              • {q}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {contact?.phone ? (
          <TouchableOpacity style={styles.actionButton} onPress={() => callNumber(contact.phone)} accessibilityRole="button">
            <Text style={styles.actionLabel}>📞 {contact.name ? t('insurance.callName', { name: contact.name }) : t('insurance.call')}</Text>
          </TouchableOpacity>
        ) : null}
        {contact?.email ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => emailTo(contact.email, t('insurance.emailSubject', { organ: gap.organLabel }), gap.draftMessage)}
            accessibilityRole="button"
          >
            <Text style={styles.actionLabel}>✉️ {t('insurance.email')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.actionButton} onPress={handleShare} accessibilityRole="button">
          <Text style={styles.actionLabel}>📝 {t('insurance.shareDraft')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={onOpenClauses} accessibilityRole="button">
          <Text style={styles.actionLabel}>📄 {t('insurance.seeClauses')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PolicyCard({ policy, onPress, t }) {
  const active = policy.ingestionStatus === 'Completed';
  return (
    <TouchableOpacity style={[styles.policyCard, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.policyTop}>
        <View style={styles.flex}>
          <Text style={typography.heading} numberOfLines={1}>
            {policy.providerName || policy.originalFilename}
          </Text>
          <Text style={typography.bodySecondary} numberOfLines={1}>
            {[policy.planName, policy.policyType].filter(Boolean).join(' · ') || policy.originalFilename}
          </Text>
        </View>
        {active ? null : <StatusBadge status={policy.ingestionStatus} />}
      </View>
      {policy.sumInsured ? (
        <Text style={typography.body}>
          {t('insurance.sumInsured')}: <Text style={styles.strong}>{formatMoney(policy.sumInsured, policy.currency)}</Text>
        </Text>
      ) : null}
      {active || policy.ingestionStatus === 'Needs Review' ? <PolicyPeriodBar policy={policy} /> : null}
      {policy.ingestionStatus === 'Needs Review' ? <Text style={styles.reviewNote}>{t('insurance.reviewToUse')}</Text> : null}
      {policy.ingestionStatus === 'Failed' ? <Text style={styles.failedNote}>{policy.processingError || t('insurance.readFailed')}</Text> : null}
    </TouchableOpacity>
  );
}

function TagRow({ tag, organsByKey, onPress, t }) {
  const palette = tag.abnormal ? coverageColors.not_covered : null;
  return (
    <TouchableOpacity style={styles.tagRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.flex}>
        <Text style={typography.body} numberOfLines={1}>
          {tag.abnormal ? '⚠️ ' : ''}
          {tag.displayName}
        </Text>
        <Text style={[typography.caption, palette && { color: palette.fg }]}>
          {tag.value ?? '—'} {tag.unit || ''} · {tag.organKeys.map((key) => organsByKey.get(key)?.label).filter(Boolean).join(', ')}
        </Text>
        <View style={styles.badgeRow}>
          {tag.policies.length === 0 ? (
            <CoverageBadge status="not_mentioned" compact />
          ) : (
            tag.policies.map((p) => <CoverageBadge key={p.policyId} status={p.status} policyName={p.policyName} compact />)
          )}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function InsuranceScreen({ navigation }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchInsurance());
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

  const organCoverageByKey = useMemo(() => new Map((data?.organCoverage || []).map((o) => [o.organKey, o])), [data]);
  const organsByKey = useMemo(() => new Map((data?.organs || []).map((o) => [o.key, o])), [data]);
  const currencyByPolicy = useMemo(() => Object.fromEntries((data?.policies || []).map((p) => [p.id, p.currency])), [data]);

  function openOrgans(title, subtitle, keys) {
    const organs = keys.map((key) => organCoverageByKey.get(key)).filter(Boolean);
    setModal({ title, subtitle, organs });
  }

  async function toggleReminders(value) {
    setSavingReminders(true);
    try {
      await updateInsuranceSettings(value);
      setData((current) => ({ ...current, remindersEnabled: value }));
    } catch (err) {
      showAlert(t('insurance.couldNotSave'), err.message);
    } finally {
      setSavingReminders(false);
    }
  }

  function goToUpload() {
    navigation.navigate('Tabs', { screen: 'UploadTab' });
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {error ? (
          <View style={styles.centered}>
            <Text style={typography.bodySecondary}>{error}</Text>
            <PrimaryButton title={t('common.retry')} onPress={load} variant="secondary" />
          </View>
        ) : (
          <ActivityIndicator style={styles.centered} color={colors.primary} />
        )}
      </SafeAreaView>
    );
  }

  const policies = data.policies;
  const confirmed = policies.filter((p) => data.activePolicyIds.includes(p.id));
  const awaiting = policies.filter((p) => p.ingestionStatus === 'Needs Review');
  const tags = showAllResults ? data.tags : data.tags.filter((tag) => tag.abnormal);
  const hiddenTagCount = data.tags.length - tags.length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>{t('insurance.subtitle')}</Text>

        {awaiting.length > 0 ? (
          <TouchableOpacity
            style={styles.reviewBanner}
            onPress={() => navigation.navigate('InsurancePolicy', { policyId: awaiting[0].id })}
            accessibilityRole="button"
          >
            <Text style={styles.reviewBannerText}>📝 {t('insurance.awaitingReview', { count: awaiting.length })} ›</Text>
          </TouchableOpacity>
        ) : null}

        {policies.length === 0 ? (
          <View style={[styles.emptyCard, cardShadow]}>
            <Text style={styles.emptyIcon}>🛡️</Text>
            <Text style={typography.heading}>{t('insurance.emptyTitle')}</Text>
            <Text style={[typography.bodySecondary, styles.centerText]}>{t('insurance.emptyBody')}</Text>
            <PrimaryButton title={t('insurance.uploadPolicy')} onPress={goToUpload} />
          </View>
        ) : null}

        {data.upcoming.length > 0 ? (
          <>
            <Text style={[typography.heading, styles.section]}>{t('insurance.upcoming')}</Text>
            <View style={styles.stack}>
              {data.upcoming.slice(0, 4).map((item) => (
                <UpcomingRow key={`${item.kind}-${item.policyId}`} item={item} t={t} />
              ))}
            </View>
          </>
        ) : null}

        {data.gaps.length > 0 ? (
          <>
            <Text style={[typography.heading, styles.section]}>{t('insurance.gapsTitle')}</Text>
            <Text style={typography.caption}>{t('insurance.gapsHint')}</Text>
            <View style={styles.stack}>
              {data.gaps.map((gap) => (
                <GapCard
                  key={gap.id}
                  gap={gap}
                  t={t}
                  onOpenClauses={() => openOrgans(gap.organLabel, gap.policyNames.join(' · '), [gap.organKey])}
                />
              ))}
            </View>
          </>
        ) : confirmed.length > 0 && data.tags.some((tag) => tag.abnormal) ? (
          <View style={styles.allClear}>
            <Text style={styles.allClearText}>✅ {t('insurance.noGaps')}</Text>
          </View>
        ) : null}

        {policies.length > 0 ? (
          <>
            <View style={[styles.sectionRow, styles.section]}>
              <Text style={typography.heading}>{t('insurance.yourPolicies')}</Text>
              <TouchableOpacity onPress={goToUpload}>
                <Text style={styles.link}>{t('insurance.addPolicy')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.stack}>
              {policies.map((policy) => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  t={t}
                  onPress={() => navigation.navigate('InsurancePolicy', { policyId: policy.id })}
                />
              ))}
            </View>
          </>
        ) : null}

        {confirmed.length > 0 ? (
          <>
            <Text style={[typography.heading, styles.section]}>{t('insurance.labResultsCover')}</Text>
            <Text style={typography.caption}>{t('insurance.labResultsHint')}</Text>
            {tags.length === 0 ? (
              <Text style={[typography.bodySecondary, styles.emptyNote]}>{t('insurance.noAbnormalTags')}</Text>
            ) : (
              <View style={[styles.tagList, cardShadow]}>
                {tags.map((tag) => (
                  <TagRow
                    key={tag.code}
                    tag={tag}
                    organsByKey={organsByKey}
                    t={t}
                    onPress={() =>
                      openOrgans(
                        tag.displayName,
                        `${tag.value ?? ''} ${tag.unit || ''}`.trim(),
                        tag.organKeys
                      )
                    }
                  />
                ))}
              </View>
            )}
            {hiddenTagCount > 0 || showAllResults ? (
              <TouchableOpacity onPress={() => setShowAllResults((v) => !v)}>
                <Text style={styles.link}>
                  {showAllResults ? t('insurance.showAbnormalOnly') : t('insurance.showAllResults', { count: hiddenTagCount })}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        {data.organCoverage.length > 0 ? (
          <>
            <Text style={[typography.heading, styles.section]}>{t('insurance.organCover')}</Text>
            <Text style={typography.caption}>{t('insurance.organCoverHint')}</Text>
            <View style={[styles.tagList, cardShadow]}>
              {data.organCoverage.map((organ) => (
                <TouchableOpacity
                  key={organ.organKey}
                  style={styles.tagRow}
                  onPress={() => openOrgans(organ.label, null, [organ.organKey])}
                  activeOpacity={0.7}
                >
                  <Text style={styles.organIcon}>{organ.icon}</Text>
                  <View style={styles.flex}>
                    <Text style={typography.body}>
                      {organ.label}
                      {organ.hasAbnormalResults ? ' ⚠️' : ''}
                    </Text>
                    <View style={styles.badgeRow}>
                      {organ.entries.length === 0 ? (
                        <CoverageBadge status="not_mentioned" compact />
                      ) : (
                        organ.entries.map((entry) => (
                          <CoverageBadge key={entry.policyId} status={entry.status} policyName={entry.policyName} compact />
                        ))
                      )}
                    </View>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {confirmed.length > 0 ? (
          <View style={[styles.settingRow, cardShadow]}>
            <View style={styles.flex}>
              <Text style={typography.body}>{t('insurance.remindersTitle')}</Text>
              <Text style={typography.caption}>{t('insurance.remindersHint')}</Text>
            </View>
            <Switch
              value={Boolean(data.remindersEnabled)}
              onValueChange={toggleReminders}
              disabled={savingReminders}
              trackColor={{ true: colors.primary }}
            />
          </View>
        ) : null}

        <Text style={styles.disclaimer}>{t('insurance.disclaimer')}</Text>
      </ScrollView>

      <CoverageClauseModal
        visible={Boolean(modal)}
        title={modal?.title}
        subtitle={modal?.subtitle}
        organs={modal?.organs}
        currencyByPolicy={currencyByPolicy}
        onClose={() => setModal(null)}
        onOpenPolicy={(policyId) => {
          setModal(null);
          navigation.navigate('InsurancePolicy', { policyId });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  flex: { flex: 1, gap: 2 },
  section: { marginTop: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stack: { gap: spacing.sm },
  strong: { fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
  centerText: { textAlign: 'center' },
  emptyNote: { marginTop: spacing.xs },
  reviewBanner: { backgroundColor: colors.warningMuted, borderRadius: radii.md, padding: spacing.md },
  reviewBannerText: { fontSize: 14, fontWeight: '700', color: colors.warning },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emptyIcon: { fontSize: 40 },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  upcomingRowUrgent: { backgroundColor: colors.dangerMuted },
  upcomingIcon: { fontSize: 22 },
  gapCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  gapHeader: { flexDirection: 'row', gap: spacing.sm },
  gapIcon: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  gapIconText: { fontSize: 22 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  paramChip: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  paramChipText: { fontSize: 12, fontWeight: '700' },
  questions: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.sm, gap: 4 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  actionLabel: { fontSize: 13, fontWeight: '700', color: colors.primary },
  policyCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  policyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reviewNote: { fontSize: 12, fontWeight: '600', color: colors.warning },
  failedNote: { fontSize: 12, fontWeight: '600', color: colors.danger },
  allClear: { backgroundColor: colors.successMuted, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  allClearText: { fontSize: 14, fontWeight: '700', color: colors.success },
  tagList: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginTop: spacing.xs },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  organIcon: { fontSize: 22 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chevron: { fontSize: 22, color: colors.textTertiary },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  disclaimer: { fontSize: 12, color: colors.textTertiary, lineHeight: 17, marginTop: spacing.md },
});
