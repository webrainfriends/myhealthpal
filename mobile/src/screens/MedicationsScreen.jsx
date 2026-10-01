import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import MedicationCard from '../components/MedicationCard';
import PrimaryButton from '../components/PrimaryButton';
import { alertSeverityColors, colors, radii, spacing, typography } from '../theme/theme';
import {
  dismissMedicationAlert,
  fetchMedicationAlerts,
  fetchMedicationReminders,
  fetchMedications,
  logMedicationDose,
  uploadMedicationScan,
} from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { openPrivacyIfConsentNeeded } from '../utils/consent';

function AlertBanner({ alert, onDismiss, onPress }) {
  const palette = alertSeverityColors[alert.severity] || alertSeverityColors.info;
  return (
    <TouchableOpacity
      style={[styles.alertBanner, { backgroundColor: palette.bg, borderLeftColor: palette.fg }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.alertBody}>
        <Text style={[typography.body, styles.alertTitle, { color: palette.fg }]}>{alert.title}</Text>
        <Text style={typography.caption} numberOfLines={2}>
          {alert.message}
        </Text>
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.dismissLabel}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DoseRow({ reminder, date, onChange, t }) {
  async function mark(slot, status) {
    try {
      const data = await logMedicationDose(reminder.medicationId, slot, status, date);
      onChange(data.reminder);
    } catch (err) {
      showAlert(t('medications.doseFailed'), err.message);
    }
  }
  return (
    <View style={styles.doseCard}>
      <View style={styles.doseHeader}>
        <Text style={[typography.body, styles.alertTitle]}>{reminder.name}</Text>
        {reminder.dosesRemaining !== null && (
          <Text style={typography.caption}>{t('medications.dosesLeft', { count: reminder.dosesRemaining })}</Text>
        )}
      </View>
      {!reminder.active && reminder.stopReason && (
        <Text style={typography.caption}>{t(`medications.remindersStopped.${reminder.stopReason}`)}</Text>
      )}
      {reminder.doses.map((dose) => (
        <View key={dose.slot} style={styles.doseLine}>
          <Text style={[typography.body, styles.alertBody]}>{dose.slot}</Text>
          {dose.status === 'pending' ? (
            <>
              <TouchableOpacity onPress={() => mark(dose.slot, 'taken')}>
                <Text style={styles.altAction}>{t('medications.taken')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => mark(dose.slot, 'skipped')}>
                <Text style={styles.dismissLabel}>{t('medications.skip')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => mark(dose.slot, 'undo')}>
              <Text style={typography.caption}>
                {dose.status === 'taken' ? '✓ ' : '– '}
                {t(dose.status === 'taken' ? 'medications.taken' : 'medications.skip')} · {t('medications.undo')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

export default function MedicationsScreen({ navigation }) {
  const t = useT();
  const [medications, setMedications] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [reminders, setReminders] = useState([]);
  const date = localDate();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [medData, alertData, reminderData] = await Promise.all([
        fetchMedications(),
        fetchMedicationAlerts('active'),
        fetchMedicationReminders(localDate()),
      ]);
      setMedications(medData.medications);
      setAlerts(alertData.alerts);
      setReminders(reminderData.reminders);
    } catch (err) {
      console.warn('Failed to load medications', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handleScanUpload(file, scanType) {
    if (!file) return;
    setScanning(true);
    try {
      const data = await uploadMedicationScan(file, scanType);
      navigation.navigate('MedicationScanReview', { scanId: data.scan.id });
    } catch (err) {
      if (openPrivacyIfConsentNeeded(err, navigation)) return;
      showAlert(t('medications.scanFailed'), err.message);
    } finally {
      setScanning(false);
    }
  }

  async function pickPrescriptionFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleScanUpload({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file }, 'prescription');
  }

  async function photograph(scanType, defaultName) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('common.permissionNeeded'), t('common.cameraPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync();
    if (result.canceled) return;
    const asset = result.assets[0];
    handleScanUpload(
      { uri: asset.uri, name: asset.fileName || defaultName, mimeType: asset.mimeType || 'image/jpeg', file: asset.file },
      scanType
    );
  }

  async function pickFromLibrary(scanType, defaultName) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('common.permissionNeeded'), t('common.libraryPermissionMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleScanUpload(
      { uri: asset.uri, name: asset.fileName || defaultName, mimeType: asset.mimeType || 'image/jpeg', file: asset.file },
      scanType
    );
  }

  async function handleDismissAlert(id) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await dismissMedicationAlert(id);
    } catch (err) {
      showAlert(t('medications.couldNotDismissAlert'), err.message);
      load();
    }
  }

  const alertsByMedicationId = new Map(alerts.map((a) => [a.medication_id, a]));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FlatList
        data={medications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={typography.title}>{t('medications.title')}</Text>
            <Text style={[typography.bodySecondary, styles.subtitle]}>{t('medications.subtitle')}</Text>

            <View style={styles.scanSection}>
              <PrimaryButton title={t('medications.scanPrescription')} onPress={pickPrescriptionFile} loading={scanning} />
              <View style={styles.scanRow}>
                <PrimaryButton
                  title={t('medications.photoOfTablet')}
                  variant="secondary"
                  onPress={() => photograph('tablet_photo', 'tablet.jpg')}
                  loading={scanning}
                />
                <PrimaryButton
                  title={t('medications.fromLibrary')}
                  variant="secondary"
                  onPress={() => pickFromLibrary('tablet_photo', 'tablet.jpg')}
                  loading={scanning}
                />
              </View>
              <TouchableOpacity onPress={() => photograph('prescription', 'prescription.jpg')}>
                <Text style={styles.altAction}>{t('medications.orPhotoPrescription')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('MedicationCreate')}>
                <Text style={styles.altAction}>{t('medications.orEnterManually')}</Text>
              </TouchableOpacity>
            </View>

            {reminders.some((r) => r.doses.length > 0) && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>{t('medications.todaysDoses')}</Text>
                {reminders
                  .filter((r) => r.doses.length > 0)
                  .map((reminder) => (
                    <DoseRow
                      key={reminder.medicationId}
                      reminder={reminder}
                      date={date}
                      t={t}
                      onChange={(next) =>
                        setReminders((prev) => prev.map((r) => (r.medicationId === next.medicationId ? { ...r, ...next } : r)))
                      }
                    />
                  ))}
              </View>
            )}

            {alerts.length > 0 && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>{t('medications.alertsHeading')}</Text>
                {alerts.map((alert) => (
                  <AlertBanner
                    key={alert.id}
                    alert={alert}
                    onDismiss={() => handleDismissAlert(alert.id)}
                    onPress={() => navigation.navigate('MedicationDetail', { medicationId: alert.medication_id })}
                  />
                ))}
              </View>
            )}

            <Text style={[typography.heading, styles.sectionHeading]}>{t('medications.yourMedications')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <MedicationCard
            medication={item}
            alert={alertsByMedicationId.get(item.id)}
            onPress={() =>
              item.is_confirmed
                ? navigation.navigate('MedicationDetail', { medicationId: item.id })
                : navigation.navigate('MedicationScanReview', { scanId: item.scan_id })
            }
          />
        )}
        ListEmptyComponent={
          !loading && <Text style={[typography.bodySecondary, styles.empty]}>{t('medications.empty')}</Text>
        }
      />
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
    paddingBottom: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  scanSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  scanRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  altAction: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionHeading: {
    marginBottom: spacing.sm,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  alertBody: {
    flex: 1,
    gap: 2,
  },
  alertTitle: {
    fontWeight: '700',
  },
  dismissLabel: {
    color: colors.textTertiary,
    fontSize: 14,
  },
  doseCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  doseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  doseLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
