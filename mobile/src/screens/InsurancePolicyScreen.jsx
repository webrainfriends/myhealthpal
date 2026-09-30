import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CoverageBadge from '../components/CoverageBadge';
import CoverageClauseModal from '../components/CoverageClauseModal';
import { ClauseEditModal, PolicyEditModal } from '../components/InsuranceEditModals';
import PolicyPeriodBar from '../components/PolicyPeriodBar';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  addInsuranceItem,
  confirmInsurancePolicy,
  deleteInsuranceItem,
  deleteInsurancePolicy,
  fetchInsurancePolicy,
  retryInsurancePolicy,
  updateInsuranceItem,
  updateInsurancePolicy,
} from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';
import { callNumber, CEILING_BASIS_KEYS, emailTo, formatMoney, openWebsite, organInfo } from '../utils/insurance';

const POLL_MS = 3000;
const MAX_POLLS = 60;

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={[typography.caption, styles.rowLabel]}>{label}</Text>
      <Text style={[typography.body, styles.rowValue]}>{value}</Text>
    </View>
  );
}

// A contact line that opens the dialer / mail app / browser when tapped.
function ContactRow({ label, name, phone, email, website, t }) {
  if (!name && !phone && !email && !website) return null;
  return (
    <View style={styles.contactBlock}>
      <Text style={[typography.caption, styles.contactRole]}>{label}</Text>
      {name ? <Text style={typography.body}>{name}</Text> : null}
      <View style={styles.contactActions}>
        {phone ? (
          <TouchableOpacity style={styles.contactChip} onPress={() => callNumber(phone)} accessibilityRole="button" accessibilityLabel={`${t('insurance.call')} ${phone}`}>
            <Text style={styles.contactChipText}>📞 {phone}</Text>
          </TouchableOpacity>
        ) : null}
        {email ? (
          <TouchableOpacity style={styles.contactChip} onPress={() => emailTo(email)} accessibilityRole="button">
            <Text style={styles.contactChipText}>✉️ {email}</Text>
          </TouchableOpacity>
        ) : null}
        {website ? (
          <TouchableOpacity style={styles.contactChip} onPress={() => openWebsite(website)} accessibilityRole="link">
            <Text style={styles.contactChipText}>🌐 {website}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function itemSummary(item, currency, t) {
  const parts = [];
  const ceiling = formatMoney(item.ceilingAmount, currency);
  if (ceiling) {
    const basis = CEILING_BASIS_KEYS[item.ceilingBasis] ? t(CEILING_BASIS_KEYS[item.ceilingBasis]) : item.ceilingBasis;
    parts.push(`${t('insurance.upTo')} ${ceiling}${basis ? ` ${basis}` : ''}`);
  }
  if (item.copayPercent) parts.push(`${t('insurance.copay')} ${item.copayPercent}%`);
  else if (item.copayAmount) parts.push(`${t('insurance.copay')} ${formatMoney(item.copayAmount, currency)}`);
  if (item.waitingPeriodMonths) parts.push(`${t('insurance.waitingPeriod')} ${t('insurance.months', { count: item.waitingPeriodMonths })}`);
  return parts.join(' · ');
}

export default function InsurancePolicyScreen({ route, navigation }) {
  const { policyId } = route.params;
  const t = useT();
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clauseModal, setClauseModal] = useState(null);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [editingClause, setEditingClause] = useState(null); // { item|null, policyId }
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await fetchInsurancePolicy(policyId);
      setPolicy(data.policy);
      setError(null);
      return data.policy;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [policyId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  // A freshly uploaded policy is still being read: refresh until it lands.
  const processing = policy && (policy.ingestionStatus === 'Processing' || policy.ingestionStatus === 'Uploaded');
  useEffect(() => {
    if (!processing) {
      polls.current = 0;
      return undefined;
    }
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  useEffect(() => {
    if (policy) navigation.setOptions({ title: policy.providerName || t('nav.insurancePolicy') });
  }, [navigation, policy, t]);

  const byOrgan = useMemo(() => {
    const groups = new Map();
    for (const item of policy?.items || []) {
      if (!groups.has(item.organKey)) groups.set(item.organKey, []);
      groups.get(item.organKey).push(item);
    }
    return [...groups.entries()].map(([key, items]) => ({ ...organInfo(key), key, items }));
  }, [policy]);

  function openClauses(organKey) {
    const info = organInfo(organKey);
    const items = policy.items.filter((item) => item.organKey === organKey);
    const covering = items.filter((item) => item.coverageStatus !== 'excluded');
    const status = covering.length === 0 ? 'not_covered' : covering.length < items.length || covering.some((i) => i.coverageStatus === 'partial') ? 'partial' : 'covered';
    setClauseModal({
      title: info.label,
      subtitle: policy.label,
      organs: [
        {
          organKey,
          label: info.label,
          icon: info.icon,
          overall: status,
          entries: [{ policyId: policy.id, policyName: policy.label, status, items, currency: policy.currency, inWaiting: false }],
        },
      ],
    });
  }

  async function run(action, failureTitle) {
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      showAlert(failureTitle, err.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    const data = await run(() => confirmInsurancePolicy(policyId), t('insurance.couldNotConfirm'));
    if (data) {
      setPolicy(data.policy);
      showAlert(t('insurance.confirmedTitle'), t('insurance.confirmedMessage'));
    }
  }

  async function handleRetry() {
    const done = await run(() => retryInsurancePolicy(policyId), t('insurance.couldNotRetry'));
    if (done) {
      polls.current = 0;
      setPolicy((current) => ({ ...current, ingestionStatus: 'Processing', processingError: null }));
    }
  }

  function handleDelete() {
    showAlert(t('insurance.deleteTitle'), t('insurance.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const ok = await run(async () => {
            await deleteInsurancePolicy(policyId);
            return true;
          }, t('insurance.couldNotDelete'));
          if (ok) navigation.goBack();
        },
      },
    ]);
  }

  async function handleSavePolicy(changes) {
    if (Object.keys(changes).length === 0) {
      setEditingPolicy(false);
      return;
    }
    const data = await run(() => updateInsurancePolicy(policyId, changes), t('insurance.couldNotSave'));
    if (data) {
      setPolicy(data.policy);
      setEditingPolicy(false);
    }
  }

  async function handleSaveClause(form) {
    const body = {
      organKey: form.organKey,
      conditionName: form.conditionName.trim(),
      coverageStatus: form.coverageStatus,
      ceilingAmount: form.ceilingAmount,
      ceilingBasis: form.ceilingBasis || '',
      copayPercent: form.copayPercent,
      waitingPeriodMonths: form.waitingPeriodMonths,
      clauseReference: form.clauseReference,
      clauseText: form.clauseText,
    };
    const item = editingClause.item;
    const saved = await run(
      () => (item ? updateInsuranceItem(policyId, item.id, body) : addInsuranceItem(policyId, body)),
      t('insurance.couldNotSave')
    );
    if (saved) {
      setEditingClause(null);
      setClauseModal(null);
      await load();
    }
  }

  async function handleDeleteClause() {
    const item = editingClause.item;
    const ok = await run(async () => {
      await deleteInsuranceItem(policyId, item.id);
      return true;
    }, t('insurance.couldNotDelete'));
    if (ok) {
      setEditingClause(null);
      setClauseModal(null);
      await load();
    }
  }

  if (!policy) {
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

  const c = policy.contacts;
  const status = policy.ingestionStatus;
  const premium = policy.nextPremium;
  const hasOther = Array.isArray(c.other) && c.other.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {processing ? (
          <View style={[styles.banner, { backgroundColor: colors.primaryMuted }]}>
            <ActivityIndicator color={colors.primary} />
            <View style={styles.flex}>
              <Text style={[typography.heading, { color: colors.primary }]}>{t('insurance.reading')}</Text>
              <Text style={typography.bodySecondary}>{t('insurance.readingHint')}</Text>
            </View>
          </View>
        ) : null}

        {status === 'Failed' ? (
          <View style={[styles.bannerColumn, { backgroundColor: colors.dangerMuted }]}>
            <Text style={[typography.heading, { color: colors.danger }]}>{t('insurance.readFailed')}</Text>
            <Text style={typography.bodySecondary}>{policy.processingError || t('insurance.readFailedHint')}</Text>
            <PrimaryButton title={t('common.retry')} onPress={handleRetry} loading={busy} />
          </View>
        ) : null}

        {status === 'Needs Review' ? (
          <View style={[styles.bannerColumn, { backgroundColor: colors.warningMuted }]}>
            <Text style={[typography.heading, { color: colors.warning }]}>{t('insurance.reviewTitle')}</Text>
            <Text style={typography.bodySecondary}>{t('insurance.reviewHint')}</Text>
            {policy.processingError ? <Text style={styles.warningNote}>{policy.processingError}</Text> : null}
            <PrimaryButton title={t('insurance.confirmPolicy')} onPress={handleConfirm} loading={busy} />
          </View>
        ) : null}

        {status === 'Needs Review' || status === 'Completed' ? (
          <>
            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{policy.providerName || policy.originalFilename}</Text>
              <Row label={t('insurance.field.plan')} value={policy.planName} />
              <Row label={t('insurance.field.policyNumber')} value={policy.policyNumber} />
              <Row label={t('insurance.field.policyType')} value={policy.policyType} />
              <Row label={t('insurance.field.policyholder')} value={policy.policyholderName} />
              <Row label={t('insurance.field.members')} value={policy.insuredMembers} />
              <Row label={t('insurance.sumInsured')} value={formatMoney(policy.sumInsured, policy.currency)} />
              {policy.summary ? <Text style={typography.bodySecondary}>{policy.summary}</Text> : null}
            </View>

            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{t('insurance.coverPeriod')}</Text>
              <PolicyPeriodBar policy={policy} />
              <Row label={t('insurance.field.initialWaiting')} value={policy.initialWaitingDays ? t('insurance.days', { count: policy.initialWaitingDays }) : null} />
              <Row label={t('insurance.field.preexistingWaiting')} value={policy.preexistingWaitingMonths ? t('insurance.months', { count: policy.preexistingWaitingMonths }) : null} />
            </View>

            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{t('insurance.premium')}</Text>
              <Row label={t('insurance.field.premiumAmount')} value={formatMoney(policy.premiumAmount, policy.currency)} />
              <Row label={t('insurance.field.frequency')} value={policy.premiumFrequency ? t(`insurance.freq.${policy.premiumFrequency}`) : null} />
              {premium ? (
                <Row
                  label={t('insurance.nextDue')}
                  value={`${formatCalendarDate(premium.dueDate)} · ${
                    premium.daysLeft < 0
                      ? t('insurance.premiumOverdue', { count: Math.abs(premium.daysLeft) })
                      : premium.daysLeft === 0
                        ? t('insurance.premiumToday')
                        : t('insurance.premiumIn', { count: premium.daysLeft })
                  }${premium.estimated ? ` (${t('insurance.estimated')})` : ''}`}
                />
              ) : (
                <Text style={typography.bodySecondary}>{t('insurance.noPremiumDate')}</Text>
              )}
              <Row label={t('insurance.field.gracePeriod')} value={policy.gracePeriodDays ? t('insurance.days', { count: policy.gracePeriodDays }) : null} />
            </View>

            <View style={[styles.card, cardShadow]}>
              <Text style={typography.heading}>{t('insurance.contacts')}</Text>
              <ContactRow label={t('insurance.contactAgent')} name={c.agentName} phone={c.agentPhone} email={c.agentEmail} t={t} />
              <ContactRow label={t('insurance.contactInsurer')} name={policy.providerName} phone={c.providerPhone} email={c.providerEmail} website={c.providerWebsite} t={t} />
              <ContactRow label={t('insurance.contactClaims')} phone={c.claimsPhone} email={c.claimsEmail} t={t} />
              <ContactRow label={t('insurance.contactSupport')} phone={c.supportPhone} email={c.supportEmail} t={t} />
              <ContactRow label={t('insurance.contactTpa')} name={c.tpaName} phone={c.tpaPhone} t={t} />
              {hasOther
                ? c.other.map((other, i) => (
                    <ContactRow key={`${other.role}-${i}`} label={other.role} name={other.name} phone={other.phone} email={other.email} t={t} />
                  ))
                : null}
              {!c.agentName && !c.agentPhone && !c.providerPhone && !c.supportPhone && !c.claimsPhone && !c.tpaPhone ? (
                <Text style={typography.bodySecondary}>{t('insurance.noContacts')}</Text>
              ) : null}
            </View>

            <View style={styles.sectionRow}>
              <Text style={typography.heading}>{t('insurance.organCover')}</Text>
              <TouchableOpacity onPress={() => setEditingClause({ item: null })}>
                <Text style={styles.link}>{t('insurance.addClause')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={typography.caption}>{t('insurance.policyOrganHint')}</Text>
            {byOrgan.length === 0 ? <Text style={typography.bodySecondary}>{t('insurance.noClauses')}</Text> : null}
            {byOrgan.map((organ) => (
              <View key={organ.key} style={[styles.card, cardShadow]}>
                <Text style={styles.organTitle}>
                  {organ.icon} {organ.label}
                </Text>
                {organ.items.map((item) => (
                  <TouchableOpacity key={item.id} style={styles.itemRow} onPress={() => openClauses(organ.key)} activeOpacity={0.7}>
                    <View style={styles.flex}>
                      <Text style={typography.body}>{item.conditionName}</Text>
                      {itemSummary(item, policy.currency, t) ? <Text style={typography.caption}>{itemSummary(item, policy.currency, t)}</Text> : null}
                      {item.needsReview ? <Text style={styles.needsCheck}>{t('insurance.needsCheck')}</Text> : null}
                    </View>
                    <CoverageBadge status={item.coverageStatus === 'excluded' ? 'not_covered' : item.coverageStatus} compact />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.footerActions}>
          {status === 'Needs Review' || status === 'Completed' ? (
            <PrimaryButton title={t('insurance.editDetails')} variant="secondary" onPress={() => setEditingPolicy(true)} />
          ) : null}
          {status === 'Needs Review' ? <PrimaryButton title={t('insurance.readAgain')} variant="secondary" onPress={handleRetry} loading={busy} /> : null}
          <TouchableOpacity onPress={handleDelete} style={styles.deleteLink}>
            <Text style={styles.deleteText}>{t('insurance.deletePolicy')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.disclaimer}>{t('insurance.disclaimer')}</Text>
      </ScrollView>

      <CoverageClauseModal
        visible={Boolean(clauseModal)}
        title={clauseModal?.title}
        subtitle={clauseModal?.subtitle}
        organs={clauseModal?.organs}
        onClose={() => setClauseModal(null)}
        onEdit={(item) => {
          // Two sheets can't be open at once on every platform.
          setClauseModal(null);
          setEditingClause({ item });
        }}
      />
      <PolicyEditModal visible={editingPolicy} policy={policy} onClose={() => setEditingPolicy(false)} onSave={handleSavePolicy} saving={busy} />
      <ClauseEditModal
        visible={Boolean(editingClause)}
        item={editingClause?.item}
        onClose={() => setEditingClause(null)}
        onSave={handleSaveClause}
        onDelete={handleDeleteClause}
        saving={busy}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  flex: { flex: 1, gap: 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.lg, padding: spacing.md },
  bannerColumn: { gap: spacing.sm, borderRadius: radii.lg, padding: spacing.md },
  warningNote: { fontSize: 12, fontWeight: '600', color: colors.warning },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowLabel: { width: 110 },
  rowValue: { flex: 1 },
  contactBlock: { gap: 4, paddingTop: spacing.xs },
  contactRole: { fontWeight: '800', textTransform: 'uppercase' },
  contactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  contactChip: { backgroundColor: colors.primaryMuted, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  contactChipText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
  organTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  needsCheck: { fontSize: 12, fontWeight: '600', color: colors.warning },
  footerActions: { gap: spacing.sm, marginTop: spacing.md },
  deleteLink: { alignItems: 'center', padding: spacing.sm },
  deleteText: { color: colors.danger, fontWeight: '700' },
  disclaimer: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
});
