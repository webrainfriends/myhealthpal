import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ChipSelect from './ChipSelect';
import PrimaryButton from './PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { INSURANCE_ORGANS } from '../utils/insurance';

// Corrections to what the AI read from a policy. Premium dates drive the
// reminders and clause values drive the coverage tags, so both are worth
// getting exactly right before the policy is confirmed.

function Field({ label, value, onChangeText, keyboardType, placeholder, multiline }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Sheet({ visible, title, onClose, children, footer }) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={typography.heading}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={styles.footer}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const POLICY_TEXT_FIELDS = [
  ['providerName', 'insurance.field.provider'],
  ['planName', 'insurance.field.plan'],
  ['policyNumber', 'insurance.field.policyNumber'],
  ['policyType', 'insurance.field.policyType'],
  ['policyholderName', 'insurance.field.policyholder'],
  ['insuredMembers', 'insurance.field.members'],
  ['currency', 'insurance.field.currency'],
];
const POLICY_NUMBER_FIELDS = [
  ['sumInsured', 'insurance.field.sumInsured'],
  ['premiumAmount', 'insurance.field.premiumAmount'],
  ['gracePeriodDays', 'insurance.field.gracePeriod'],
  ['initialWaitingDays', 'insurance.field.initialWaiting'],
  ['preexistingWaitingMonths', 'insurance.field.preexistingWaiting'],
];
const POLICY_DATE_FIELDS = [
  ['policyStartDate', 'insurance.field.startDate'],
  ['policyEndDate', 'insurance.field.endDate'],
  ['nextPremiumDueDate', 'insurance.field.nextPremiumDue'],
];
const POLICY_CONTACT_FIELDS = [
  ['providerPhone', 'insurance.field.insurerPhone'],
  ['providerEmail', 'insurance.field.insurerEmail'],
  ['providerWebsite', 'insurance.field.website'],
  ['claimsPhone', 'insurance.field.claimsPhone'],
  ['claimsEmail', 'insurance.field.claimsEmail'],
  ['agentName', 'insurance.field.agentName'],
  ['agentPhone', 'insurance.field.agentPhone'],
  ['agentEmail', 'insurance.field.agentEmail'],
  ['supportPhone', 'insurance.field.supportPhone'],
  ['supportEmail', 'insurance.field.supportEmail'],
  ['tpaName', 'insurance.field.tpaName'],
  ['tpaPhone', 'insurance.field.tpaPhone'],
];

function valueOf(policy, key) {
  const raw = key in (policy.contacts || {}) ? policy.contacts[key] : policy[key];
  if (raw === null || raw === undefined) return '';
  // A DATE column may arrive as a full timestamp string; the field is YYYY-MM-DD.
  return key.endsWith('Date') ? String(raw).slice(0, 10) : String(raw);
}

const FREQUENCY_OPTIONS = (t) => [
  { value: 'monthly', label: t('insurance.freq.monthly') },
  { value: 'quarterly', label: t('insurance.freq.quarterly') },
  { value: 'half_yearly', label: t('insurance.freq.half_yearly') },
  { value: 'annual', label: t('insurance.freq.annual') },
  { value: 'single', label: t('insurance.freq.single') },
];

export function PolicyEditModal({ visible, policy, onClose, onSave, saving }) {
  const t = useT();
  const [values, setValues] = useState({});
  const [frequency, setFrequency] = useState(null);

  useEffect(() => {
    if (!visible || !policy) return;
    const initial = {};
    for (const [key] of [...POLICY_TEXT_FIELDS, ...POLICY_NUMBER_FIELDS, ...POLICY_DATE_FIELDS, ...POLICY_CONTACT_FIELDS]) {
      initial[key] = valueOf(policy, key);
    }
    setValues(initial);
    setFrequency(policy.premiumFrequency || null);
  }, [visible, policy]);

  function set(key) {
    return (text) => setValues((current) => ({ ...current, [key]: text }));
  }

  function handleSave() {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== valueOf(policy, key)) changes[key] = value;
    }
    if ((frequency || null) !== (policy.premiumFrequency || null)) changes.premiumFrequency = frequency || '';
    onSave(changes);
  }

  return (
    <Sheet
      visible={visible}
      title={t('insurance.editDetails')}
      onClose={onClose}
      footer={<PrimaryButton title={t('common.save')} onPress={handleSave} loading={saving} />}
    >
      {POLICY_TEXT_FIELDS.map(([key, label]) => (
        <Field key={key} label={t(label)} value={values[key] ?? ''} onChangeText={set(key)} />
      ))}
      {POLICY_NUMBER_FIELDS.map(([key, label]) => (
        <Field key={key} label={t(label)} value={values[key] ?? ''} onChangeText={set(key)} keyboardType="numeric" />
      ))}
      {POLICY_DATE_FIELDS.map(([key, label]) => (
        <Field key={key} label={`${t(label)} (YYYY-MM-DD)`} value={values[key] ?? ''} onChangeText={set(key)} placeholder="2026-12-31" />
      ))}
      <ChipSelect label={t('insurance.field.frequency')} options={FREQUENCY_OPTIONS(t)} value={frequency} onChange={setFrequency} />
      <Text style={[styles.label, styles.groupLabel]}>{t('insurance.contacts')}</Text>
      {POLICY_CONTACT_FIELDS.map(([key, label]) => (
        <Field key={key} label={t(label)} value={values[key] ?? ''} onChangeText={set(key)} />
      ))}
    </Sheet>
  );
}

const STATUS_OPTIONS = (t) => [
  { value: 'covered', label: t('insurance.covered') },
  { value: 'partial', label: t('insurance.partial') },
  { value: 'excluded', label: t('insurance.excluded') },
];
const BASIS_OPTIONS = (t) => [
  { value: 'per_illness', label: t('insurance.basisPerIllness') },
  { value: 'per_year', label: t('insurance.basisPerYear') },
  { value: 'per_claim', label: t('insurance.basisPerClaim') },
  { value: 'lifetime', label: t('insurance.basisLifetime') },
];

// Edits one clause - or, with no `item`, adds a new one.
export function ClauseEditModal({ visible, item, onClose, onSave, onDelete, saving }) {
  const t = useT();
  const [form, setForm] = useState({});

  useEffect(() => {
    if (!visible) return;
    setForm({
      organKey: item?.organKey || 'general',
      conditionName: item?.conditionName || '',
      coverageStatus: item?.coverageStatus || 'covered',
      ceilingAmount: item?.ceilingAmount != null ? String(item.ceilingAmount) : '',
      ceilingBasis: item?.ceilingBasis || null,
      copayPercent: item?.copayPercent != null ? String(item.copayPercent) : '',
      waitingPeriodMonths: item?.waitingPeriodMonths != null ? String(item.waitingPeriodMonths) : '',
      clauseReference: item?.clauseReference || '',
      clauseText: item?.clauseText || '',
    });
  }, [visible, item]);

  function set(key) {
    return (value) => setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Sheet
      visible={visible}
      title={item ? t('insurance.editClause') : t('insurance.addClause')}
      onClose={onClose}
      footer={
        <View style={styles.footerStack}>
          <PrimaryButton title={t('common.save')} onPress={() => onSave(form)} loading={saving} disabled={!form.conditionName?.trim()} />
          {item && onDelete ? (
            <TouchableOpacity onPress={onDelete} style={styles.deleteLink}>
              <Text style={styles.deleteText}>{t('insurance.removeClause')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    >
      <Field label={t('insurance.field.condition')} value={form.conditionName ?? ''} onChangeText={set('conditionName')} />
      <ChipSelect label={t('insurance.status')} options={STATUS_OPTIONS(t)} value={form.coverageStatus} onChange={(v) => set('coverageStatus')(v || 'covered')} allowClear={false} />
      <ChipSelect
        label={t('insurance.field.organ')}
        options={INSURANCE_ORGANS.map((organ) => ({ value: organ.key, label: `${organ.icon} ${organ.label}` }))}
        value={form.organKey}
        onChange={(v) => set('organKey')(v || 'general')}
        allowClear={false}
      />
      <Field label={t('insurance.ceiling')} value={form.ceilingAmount ?? ''} onChangeText={set('ceilingAmount')} keyboardType="numeric" />
      <ChipSelect label={t('insurance.field.ceilingBasis')} options={BASIS_OPTIONS(t)} value={form.ceilingBasis} onChange={set('ceilingBasis')} />
      <Field label={`${t('insurance.copay')} (%)`} value={form.copayPercent ?? ''} onChangeText={set('copayPercent')} keyboardType="numeric" />
      <Field label={`${t('insurance.waitingPeriod')} (${t('insurance.field.monthsUnit')})`} value={form.waitingPeriodMonths ?? ''} onChangeText={set('waitingPeriodMonths')} keyboardType="numeric" />
      <Field label={t('insurance.clause')} value={form.clauseReference ?? ''} onChangeText={set('clauseReference')} />
      <Field label={t('insurance.fromYourPolicy')} value={form.clauseText ?? ''} onChangeText={set('clauseText')} multiline />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '92%',
    paddingTop: spacing.md,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  close: { fontSize: 18, color: colors.textSecondary },
  sheetBody: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  footer: { padding: spacing.lg, paddingTop: spacing.sm },
  footerStack: { gap: spacing.sm },
  field: { gap: 4 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  groupLabel: { marginTop: spacing.sm, fontSize: 13, fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  deleteLink: { alignItems: 'center', padding: spacing.sm },
  deleteText: { color: colors.danger, fontWeight: '700' },
});
