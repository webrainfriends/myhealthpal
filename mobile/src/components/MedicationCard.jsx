import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { alertSeverityColors, cardShadow, colors, medicationStatusColors, radii, spacing, typography } from '../theme/theme';
import { useT } from '../i18n/I18nContext';

function doseLine(medication, t) {
  const parts = [];
  if (medication.dosage_amount) parts.push(`${medication.dosage_amount}${medication.dosage_unit || ''}`);
  if (medication.form) parts.push(medication.form);
  if (medication.frequency_per_day) {
    parts.push(t('medicationDetail.timesPerDay', { count: medication.frequency_per_day }));
  }
  return parts.join(' · ') || t('medicationDetail.notRecorded');
}

const STATUS_KEYS = {
  active: 'medicationDetail.statusActive',
  completed: 'medicationDetail.statusCompleted',
  discontinued: 'medicationDetail.statusDiscontinued',
};

export default function MedicationCard({ medication, alert, onPress }) {
  const t = useT();
  const statusPalette = medicationStatusColors[medication.status] || medicationStatusColors.active;
  const alertPalette = alert ? alertSeverityColors[alert.severity] || alertSeverityColors.info : null;
  const statusLabel = t(STATUS_KEYS[medication.status] || STATUS_KEYS.active);

  return (
    <TouchableOpacity style={[styles.card, cardShadow]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <Text style={[typography.heading, styles.name]} numberOfLines={1}>
          {medication.name}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: statusPalette.bg }]}>
          <Text style={[styles.statusPillText, { color: statusPalette.fg }]}>{statusLabel}</Text>
        </View>
      </View>

      <Text style={typography.bodySecondary}>{doseLine(medication, t)}</Text>
      {medication.prescribed_for && (
        <Text style={typography.caption} numberOfLines={1}>
          {t('medicationDetail.forLabel', { value: medication.prescribed_for })}
        </Text>
      )}

      {medication.needs_review && (
        <View style={[styles.miniPill, { backgroundColor: colors.warningMuted }]}>
          <Text style={[styles.miniPillText, { color: colors.warning }]}>{t('measurement.needsReview')}</Text>
        </View>
      )}

      {alert && (
        <View style={[styles.alertRow, { backgroundColor: alertPalette.bg }]}>
          <Text style={[styles.alertText, { color: alertPalette.fg }]} numberOfLines={2}>
            {alert.title}
          </Text>
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
    marginBottom: spacing.sm,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
  },
  statusPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  miniPill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  miniPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  alertRow: {
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: spacing.xs,
  },
  alertText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
