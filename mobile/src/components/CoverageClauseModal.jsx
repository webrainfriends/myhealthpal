import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import CoverageBadge from './CoverageBadge';
import { colors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { CEILING_BASIS_KEYS, formatMoney } from '../utils/insurance';
import { formatCalendarDate } from '../utils/date';

// Item statuses use covered / partial / excluded; the badge speaks in
// covered / partial / not_covered.
function badgeStatus(item) {
  return item.coverageStatus === 'excluded' ? 'not_covered' : item.coverageStatus;
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.detailRow}>
      <Text style={[typography.caption, styles.detailLabel]}>{label}</Text>
      <Text style={[typography.bodySecondary, styles.detailValue]}>{value}</Text>
    </View>
  );
}

function ceilingText(item, currency, t) {
  const amount = formatMoney(item.ceilingAmount, currency);
  if (!amount) return null;
  const basisKey = CEILING_BASIS_KEYS[item.ceilingBasis];
  const basis = basisKey ? t(basisKey) : item.ceilingBasis;
  return basis ? `${amount} · ${basis}` : amount;
}

function waitingText(item, waitingUntil, t) {
  if (!item.waitingPeriodMonths) return null;
  const base = t('insurance.months', { count: item.waitingPeriodMonths });
  return waitingUntil ? `${base} · ${t('insurance.untilDate', { date: formatCalendarDate(waitingUntil) })}` : base;
}

// One clause: what it covers or excludes, the ceiling / co-pay for it, and
// the policy's own wording. Everything shown is what the document said (or
// what the person corrected it to) - never the app's interpretation.
export function ClauseCard({ item, currency, waitingUntil, onEdit, t }) {
  const copay = item.copayPercent
    ? `${item.copayPercent}%`
    : item.copayAmount
      ? formatMoney(item.copayAmount, currency)
      : null;
  return (
    <View style={styles.clauseCard}>
      <View style={styles.clauseHeader}>
        <Text style={[typography.body, styles.clauseTitle]}>{item.conditionName}</Text>
        <CoverageBadge status={badgeStatus(item)} compact />
      </View>
      <DetailRow label={t('insurance.ceiling')} value={ceilingText(item, currency, t)} />
      <DetailRow label={t('insurance.copay')} value={copay} />
      <DetailRow label={t('insurance.deductible')} value={formatMoney(item.deductibleAmount, currency)} />
      <DetailRow label={t('insurance.waitingPeriod')} value={waitingText(item, waitingUntil, t)} />
      <DetailRow label={t('insurance.conditions')} value={item.subLimitNote} />
      <DetailRow label={t('insurance.clause')} value={item.clauseReference} />
      {item.clauseText ? (
        <View style={styles.quote}>
          <Text style={[typography.caption, styles.quoteLabel]}>{t('insurance.fromYourPolicy')}</Text>
          <Text style={typography.bodySecondary}>{item.clauseText}</Text>
        </View>
      ) : null}
      {item.needsReview ? <Text style={styles.needsCheck}>{t('insurance.needsCheck')}</Text> : null}
      {onEdit ? (
        <TouchableOpacity onPress={() => onEdit(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.editLink}>{t('common.edit')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Bottom sheet listing, for one or more organs, each policy's clauses. Opened
// from a lab-result tag, an organ row or a coverage gap. `organs` are the
// server's organCoverage objects: { organKey, label, icon, overall, entries }.
export default function CoverageClauseModal({ visible, title, subtitle, organs, currencyByPolicy, onClose, onOpenPolicy, onEdit }) {
  const t = useT();
  if (!visible) return null;
  const list = organs || [];
  const hasEntries = list.some((organ) => organ.entries.length > 0);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleBlock}>
              <Text style={typography.heading} numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? <Text style={typography.caption}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {!hasEntries ? <Text style={typography.bodySecondary}>{t('insurance.noClauses')}</Text> : null}
            {list.map((organ) =>
              organ.entries.length === 0 ? null : (
                <View key={organ.organKey} style={styles.organBlock}>
                  <Text style={styles.organTitle}>
                    {organ.icon} {organ.label}
                  </Text>
                  {organ.entries.map((entry) => (
                    <View key={`${organ.organKey}-${entry.policyId}`} style={styles.entryBlock}>
                      <TouchableOpacity
                        style={styles.policyRow}
                        onPress={onOpenPolicy ? () => onOpenPolicy(entry.policyId) : undefined}
                        disabled={!onOpenPolicy}
                        activeOpacity={0.7}
                      >
                        <Text style={[typography.body, styles.policyName]} numberOfLines={1}>
                          {entry.policyName}
                        </Text>
                        <CoverageBadge status={entry.status} compact />
                      </TouchableOpacity>
                      {entry.inWaiting ? (
                        <Text style={styles.waitingNote}>
                          {t('insurance.inWaiting', { date: formatCalendarDate(entry.waitingUntil) })}
                        </Text>
                      ) : null}
                      {entry.items.map((item) => (
                        <ClauseCard
                          key={item.id}
                          item={item}
                          currency={entry.currency || currencyByPolicy?.[entry.policyId]}
                          onEdit={onEdit ? (it) => onEdit(it, entry.policyId) : undefined}
                          t={t}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              )
            )}
            <Text style={styles.disclaimer}>{t('insurance.disclaimer')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  backdrop: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '85%',
    paddingTop: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  sheetTitleBlock: { flex: 1, gap: 2 },
  close: { fontSize: 18, color: colors.textSecondary },
  sheetBody: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  organBlock: { gap: spacing.sm },
  organTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  entryBlock: { gap: spacing.sm },
  policyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  policyName: { flex: 1, fontWeight: '700' },
  waitingNote: { fontSize: 12, color: colors.warning, fontWeight: '600' },
  clauseCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 6,
  },
  clauseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  clauseTitle: { flex: 1, fontWeight: '700' },
  detailRow: { flexDirection: 'row', gap: spacing.sm },
  detailLabel: { width: 96 },
  detailValue: { flex: 1 },
  quote: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  quoteLabel: { fontWeight: '700' },
  needsCheck: { fontSize: 12, fontWeight: '600', color: colors.warning },
  editLink: { fontSize: 13, fontWeight: '700', color: colors.primary },
  disclaimer: { fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
});
