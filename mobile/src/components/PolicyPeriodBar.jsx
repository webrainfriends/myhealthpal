import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';
import { formatCalendarDate } from '../utils/date';

// The cover period as a bar: start date, how far through the term today is,
// and the end date - "coverage duration" at a glance.
export default function PolicyPeriodBar({ policy }) {
  const t = useT();
  const { period } = policy;
  const startDate = period.periodStart || policy.policyStartDate;
  const endDate = period.periodEnd || policy.policyEndDate;
  if (!startDate && !endDate) {
    return <Text style={typography.caption}>{t('insurance.periodUnknown')}</Text>;
  }
  const expired = period.state === 'expired';
  const nearEnd = !expired && period.daysToEnd !== null && period.daysToEnd <= 30;
  const fill = expired ? colors.textTertiary : nearEnd ? colors.warning : colors.success;
  let status = t('insurance.periodActive');
  if (expired) status = t('insurance.periodExpired');
  else if (period.state === 'upcoming') status = t('insurance.periodUpcoming', { count: period.daysToStart });
  else if (period.daysToEnd !== null) status = t('insurance.periodEndsIn', { count: period.daysToEnd });

  return (
    <View style={styles.container}>
      {period.elapsedPercent !== null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${period.elapsedPercent}%`, backgroundColor: fill }]} />
        </View>
      ) : null}
      <View style={styles.labels}>
        <Text style={typography.caption}>{startDate ? formatCalendarDate(startDate) : '—'}</Text>
        <Text style={[typography.caption, { color: fill, fontWeight: '700' }]}>{status}</Text>
        <Text style={typography.caption}>{endDate ? formatCalendarDate(endDate) : '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radii.pill },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
