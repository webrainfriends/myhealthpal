import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { formatCalendarDate } from '../utils/date';

// Within this many days the "Book test" button is shown prominently on the
// card itself - the moment the recheck turns from a countdown into a to-do.
export const BOOKING_WINDOW_DAYS = 14;

export function openBooking(plan) {
  if (plan.bookingUrl) Linking.openURL(plan.bookingUrl).catch((err) => console.warn('Could not open booking link', err.message));
}

function urgencyPalette(daysLeft) {
  if (daysLeft <= 0) return { fg: colors.danger, bg: colors.dangerMuted };
  if (daysLeft <= 14) return { fg: colors.warning, bg: colors.warningMuted };
  return { fg: colors.primary, bg: colors.primaryMuted };
}

export function countdownLabel(daysLeft, t) {
  if (daysLeft === 0) return t('retest.dueToday');
  if (daysLeft === -1) return t('retest.oneDayOverdue');
  if (daysLeft < 0) return t('retest.overdue', { count: Math.abs(daysLeft) });
  if (daysLeft === 1) return t('retest.oneDayLeft');
  return t('retest.daysLeft', { count: daysLeft });
}

export function reasonLabel(plan, t) {
  if (plan.reason === 'medication_onset') return t('retest.reasonMedication', { medication: plan.medicationName });
  return t('retest.reasonAbnormal', { flag: String(plan.flag || '').toLowerCase() });
}

// One "check again by" countdown: the parameter, why it needs a recheck,
// the days left, and this week's small action with a tick box. `actions`
// (snooze / not needed / trend) are only shown on the full Retest Radar
// screen; the dashboard shows the compact form.
export default function RetestPlanCard({ plan, t, onToggleCheckin, onPress, actions }) {
  const palette = urgencyPalette(plan.daysLeft);
  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={onPress ? 0.8 : 1} disabled={!onPress}>
      <View style={styles.topRow}>
        <View style={[styles.countdown, { backgroundColor: palette.bg }]}>
          <Text style={[styles.countdownNumber, { color: palette.fg }]}>{Math.abs(plan.daysLeft)}</Text>
          <Text style={[styles.countdownUnit, { color: palette.fg }]}>
            {plan.daysLeft < 0 ? t('retest.daysLate') : t('retest.days')}
          </Text>
        </View>
        <View style={styles.titleBlock}>
          <Text style={typography.heading} numberOfLines={1}>
            {plan.parameterDisplayName}
          </Text>
          <Text style={[typography.caption, { color: palette.fg }]}>
            {countdownLabel(plan.daysLeft, t)} · {t('retest.dueOn', { date: formatCalendarDate(plan.dueDate) })}
          </Text>
          <Text style={typography.caption} numberOfLines={2}>
            {reasonLabel(plan, t)}
          </Text>
        </View>
      </View>

      {plan.bookingUrl && plan.daysLeft <= BOOKING_WINDOW_DAYS && (
        <TouchableOpacity style={styles.bookButton} onPress={() => openBooking(plan)} activeOpacity={0.8} accessibilityRole="link">
          <Text style={styles.bookLabel}>🧪 {t('retest.bookTest')}</Text>
        </TouchableOpacity>
      )}

      {plan.microAction ? (
        <TouchableOpacity
          style={[styles.actionRow, plan.checkedInThisWeek && styles.actionRowDone]}
          onPress={() => onToggleCheckin(plan)}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: plan.checkedInThisWeek }}
        >
          <View style={[styles.checkbox, plan.checkedInThisWeek && styles.checkboxDone]}>
            {plan.checkedInThisWeek && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionLabel}>{t('retest.thisWeek')}</Text>
            <Text style={typography.bodySecondary}>{plan.microAction}</Text>
            {plan.streakWeeks > 1 && <Text style={styles.streak}>{t('retest.streak', { count: plan.streakWeeks })}</Text>}
          </View>
        </TouchableOpacity>
      ) : null}

      {actions && actions.length > 0 && (
        <View style={styles.buttonsRow}>
          {actions.map((action) => (
            <TouchableOpacity key={action.label} onPress={action.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.buttonLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  countdown: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 22,
  },
  countdownUnit: {
    fontSize: 10,
    fontWeight: '600',
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  bookButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  bookLabel: {
    color: colors.onBrand,
    fontSize: 14,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  actionRowDone: {
    backgroundColor: colors.successMuted,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkmark: {
    color: colors.onBrand,
    fontSize: 13,
    fontWeight: '800',
  },
  actionText: {
    flex: 1,
    gap: 2,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  streak: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});
