import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GradientFill from './brand/GradientFill';
import { brandShadow, colors, radii, spacing } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatMoney } from '../utils/insurance';
import { formatCalendarDate } from '../utils/date';

function dueLabel(due, kind, t) {
  if (!due) return null;
  if (kind === 'premium') {
    if (due.daysLeft < 0) return t('insurance.premiumOverdue', { count: Math.abs(due.daysLeft) });
    if (due.daysLeft === 0) return t('insurance.premiumToday');
    return t('insurance.premiumIn', { count: due.daysLeft });
  }
  if (due.daysLeft === 0) return t('insurance.renewsToday');
  return t('insurance.renewsIn', { count: due.daysLeft });
}

// Dashboard tile for My Insurance. Tells the person the three things worth a
// glance - how many policies are active, the next premium, and how many
// coverage gaps their latest results raise - and opens the full screen. With
// nothing added yet it becomes a prompt to upload a policy.
export default function InsuranceCard({ summary, onPress }) {
  const t = useT();
  const empty = !summary || (summary.totalCount === 0);
  const nextPremium = summary?.nextPremium;
  const nextRenewal = summary?.nextRenewal;
  const urgent = nextPremium && nextPremium.daysLeft <= 14;

  return (
    <TouchableOpacity style={[styles.card, brandShadow]} onPress={onPress} activeOpacity={0.9} accessibilityRole="button">
      <GradientFill colors={['#0E9FB4', '#4F7BFF']} />
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>🛡️ {t('insurance.cardTitle')}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {empty
              ? t('insurance.cardEmptyHint')
              : summary.policyCount > 0
                ? t('insurance.cardPolicies', { count: summary.policyCount })
                : t('insurance.cardNeedsReview', { count: summary.needsReviewCount || summary.processingCount || summary.totalCount })}
          </Text>
        </View>
        {!empty && summary.gapCount > 0 ? (
          <View style={styles.gapBadge}>
            <Text style={styles.gapCount}>{summary.gapCount}</Text>
            <Text style={styles.gapLabel}>{t('insurance.toDiscuss')}</Text>
          </View>
        ) : null}
      </View>

      {empty ? (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{t('insurance.cardEmpty')} ›</Text>
        </View>
      ) : (
        <View style={styles.metaRow}>
          {nextPremium ? (
            <View style={[styles.metaChip, urgent && styles.metaChipUrgent]}>
              <Text style={[styles.metaText, urgent && styles.metaTextUrgent]} numberOfLines={1}>
                💳 {dueLabel(nextPremium, 'premium', t)}
                {nextPremium.amount ? ` · ${formatMoney(nextPremium.amount, nextPremium.currency)}` : ''}
              </Text>
            </View>
          ) : null}
          {nextRenewal ? (
            <View style={styles.metaChip}>
              <Text style={styles.metaText} numberOfLines={1}>
                🔄 {dueLabel(nextRenewal, 'renewal', t)} · {formatCalendarDate(nextRenewal.date, { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          ) : null}
          {summary.topGap ? (
            <View style={[styles.metaChip, styles.metaChipWide]}>
              <Text style={styles.metaText} numberOfLines={1}>
                💬 {summary.topGap.title}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
    backgroundColor: colors.teal,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  titleBlock: { flex: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.onBrand },
  subtitle: { fontSize: 13, color: colors.onBrandMuted },
  gapBadge: {
    backgroundColor: colors.onBrand,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
  },
  gapCount: { fontSize: 20, fontWeight: '800', color: colors.danger },
  gapLabel: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  cta: {
    alignSelf: 'flex-start',
    backgroundColor: colors.onBrand,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaText: { fontSize: 14, fontWeight: '700', color: colors.teal },
  metaRow: { gap: 6 },
  metaChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  metaChipUrgent: { backgroundColor: colors.onBrand },
  metaChipWide: { alignSelf: 'stretch' },
  metaText: { fontSize: 13, fontWeight: '600', color: colors.onBrand },
  metaTextUrgent: { color: colors.danger },
});
