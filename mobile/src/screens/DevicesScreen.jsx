import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import MiniTrendChart from '../components/MiniTrendChart';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import {
  fetchPairedDevices,
  pairDevice,
  renameDevice,
  unpairDevice,
  syncDeviceReadings,
  fetchVitalsSummary,
  fetchVitalsHistory,
  logActivity,
} from '../api/client';
import { showAlert } from '../utils/alert';
import { DEVICE_PROFILES } from '../ble/deviceProfiles';
import { isBleAvailable, requestBlePermissions, scanForDevices, connectAndSync, isBluetoothPoweredOn } from '../ble/bleService';
import { isStepSyncAvailable, stepSourceForPlatform, fetchDailyStepsSince } from '../health/stepSync';

const DEVICE_TYPE_ICON = {
  blood_glucose_meter: '🩸',
  blood_pressure_monitor: '💓',
  smart_scale: '⚖️',
  step_tracker: '👣',
};

const READING_TYPE_LABEL = {
  blood_glucose: 'Blood glucose',
  blood_pressure: 'Blood pressure',
  body_weight: 'Weight',
};

const CLASSIFICATION_PALETTE = {
  low: healthStatusColors.watch,
  normal: healthStatusColors.good,
  elevated: healthStatusColors.watch,
  high: healthStatusColors.attention,
  crisis: healthStatusColors.attention,
};

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

// The platform-health "device" isn't something a person scans for - there
// is exactly one HealthKit store and one Health Connect store per phone,
// so pairing it is just registering that connection directly.
const PLATFORM_STEP_SOURCE = stepSourceForPlatform();
const PLATFORM_STEP_LABEL = PLATFORM_STEP_SOURCE === 'apple_health' ? 'Apple Health' : 'Health Connect';

function DeviceRow({ device, onRename, onUnpair, onSync, syncing }) {
  return (
    <View style={styles.deviceRow}>
      <View style={styles.deviceRowHeader}>
        <Text style={styles.deviceIcon}>{DEVICE_TYPE_ICON[device.deviceType] || '📟'}</Text>
        <View style={styles.deviceRowText}>
          <Text style={typography.body} numberOfLines={1}>{device.name}</Text>
          <Text style={typography.caption}>Last synced: {formatDateTime(device.lastSyncedAt)}</Text>
        </View>
      </View>
      <View style={styles.deviceRowActions}>
        <TouchableOpacity style={styles.smallAction} onPress={() => onRename(device)}>
          <Text style={styles.smallActionText}>Rename</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallAction} onPress={() => onUnpair(device)}>
          <Text style={[styles.smallActionText, styles.dangerText]}>Unpair</Text>
        </TouchableOpacity>
        <PrimaryButton title="Sync now" onPress={() => onSync(device)} loading={syncing} />
      </View>
    </View>
  );
}

function ScanModal({ visible, deviceType, onClose, onPaired }) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState([]);
  const [pairingId, setPairingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return undefined;
    setFound([]);
    setError(null);

    let stopScan = null;
    let cancelled = false;

    (async () => {
      if (!isBleAvailable()) {
        setError('Bluetooth isn’t available in this build - it needs a custom dev client (see the README).');
        return;
      }
      const poweredOn = await isBluetoothPoweredOn();
      if (!poweredOn) {
        setError('Turn on Bluetooth to scan for devices.');
        return;
      }
      const granted = await requestBlePermissions();
      if (!granted) {
        setError('Bluetooth permission is required to scan for devices.');
        return;
      }
      if (cancelled) return;
      setScanning(true);
      stopScan = scanForDevices((device, err) => {
        if (err) {
          setError(err.message);
          return;
        }
        setFound((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device]));
      });
      setTimeout(() => setScanning(false), 15000);
    })();

    return () => {
      cancelled = true;
      if (stopScan) stopScan();
      setScanning(false);
    };
  }, [visible]);

  async function handlePair(scanned) {
    setPairingId(scanned.id);
    try {
      const { device } = await pairDevice({
        deviceType,
        connectionType: 'ble',
        name: scanned.name || DEVICE_PROFILES[deviceType].label,
        bluetoothId: scanned.id,
      });
      // handleSync re-derives the Mi Scale-vs-standard profile from the
      // device's own name (see DevicesScreen's own handleSync) - not
      // repeated here, so pairing and every later "Sync now" tap always
      // agree on which GATT profile to use.
      onPaired(device);
    } catch (err) {
      showAlert('Could not pair device', err.message);
    } finally {
      setPairingId(null);
    }
  }

  const profile = DEVICE_PROFILES[deviceType];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={typography.heading}>Pair a {profile?.label?.toLowerCase()}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>Done</Text>
          </TouchableOpacity>
        </View>
        <Text style={typography.bodySecondary}>
          Turn on your device and put it in pairing mode. Examples: {profile?.examples?.join(', ')}.
        </Text>

        {error ? (
          <Text style={[typography.bodySecondary, styles.errorText]}>{error}</Text>
        ) : (
          <View style={styles.scanStatusRow}>
            {scanning && <ActivityIndicator color={colors.primary} />}
            <Text style={typography.bodySecondary}>{scanning ? 'Scanning…' : `${found.length} found`}</Text>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.scanList}>
          {found.map((scanned) => (
            <TouchableOpacity
              key={scanned.id}
              style={[styles.card, styles.scanRow]}
              onPress={() => handlePair(scanned)}
              disabled={pairingId !== null}
            >
              <Text style={typography.body}>{scanned.name || 'Unnamed device'}</Text>
              {pairingId === scanned.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.pairLabel}>Pair</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function RenameModal({ device, onClose, onRenamed }) {
  const [name, setName] = useState(device?.name || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(device?.name || '');
  }, [device]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !device) return;
    setSaving(true);
    try {
      await renameDevice(device.id, trimmed);
      onRenamed();
    } catch (err) {
      showAlert('Could not rename device', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={device !== null} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.renameOverlay}>
        <View style={[styles.card, styles.renameCard]}>
          <Text style={typography.heading}>Rename device</Text>
          <TextInput style={styles.renameInput} value={name} onChangeText={setName} autoFocus />
          <View style={styles.renameActions}>
            <PrimaryButton title="Cancel" variant="secondary" onPress={onClose} />
            <PrimaryButton title="Save" onPress={handleSave} loading={saving} disabled={!name.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VitalSummaryCard({ readingType, reading, history }) {
  const points = history.map((r) => ({
    date: r.measuredAt,
    value: readingType === 'blood_pressure' ? r.systolicMmHg : readingType === 'blood_glucose' ? r.glucoseMgDl : r.weightKg,
  }));
  const palette = reading?.classification ? CLASSIFICATION_PALETTE[reading.classification] : healthStatusColors.no_data;

  return (
    <View style={[styles.card, styles.vitalCard]}>
      <View style={styles.vitalHeaderRow}>
        <Text style={typography.heading}>{READING_TYPE_LABEL[readingType]}</Text>
        {reading?.classification && (
          <View style={[styles.classificationPill, { backgroundColor: palette.bg }]}>
            <Text style={[styles.classificationText, { color: palette.fg }]}>{reading.classification}</Text>
          </View>
        )}
      </View>
      {reading ? (
        <>
          <Text style={styles.vitalValue}>
            {readingType === 'blood_glucose' && `${reading.glucoseMgDl} mg/dL`}
            {readingType === 'blood_pressure' && `${reading.systolicMmHg}/${reading.diastolicMmHg} mmHg`}
            {readingType === 'body_weight' && `${reading.weightKg} kg`}
          </Text>
          <Text style={typography.caption}>{formatDateTime(reading.measuredAt)}</Text>
        </>
      ) : (
        <Text style={typography.bodySecondary}>No readings synced yet.</Text>
      )}
      {points.length > 1 && (
        <View style={styles.miniChart}>
          <MiniTrendChart points={points} />
        </View>
      )}
    </View>
  );
}

export default function DevicesScreen() {
  const [devices, setDevices] = useState([]);
  const [vitalsSummary, setVitalsSummary] = useState({});
  const [vitalsHistory, setVitalsHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [scanDeviceType, setScanDeviceType] = useState(null);
  const [syncingDeviceId, setSyncingDeviceId] = useState(null);
  const [renamingDevice, setRenamingDevice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [devicesData, summaryData] = await Promise.all([fetchPairedDevices(), fetchVitalsSummary()]);
      setDevices(devicesData.devices);
      setVitalsSummary(summaryData.summary);

      const historyEntries = await Promise.all(
        Object.keys(READING_TYPE_LABEL).map(async (readingType) => {
          const { readings } = await fetchVitalsHistory(readingType, 90);
          return [readingType, readings];
        })
      );
      setVitalsHistory(Object.fromEntries(historyEntries));
    } catch (err) {
      console.warn('Failed to load devices', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pairedPlatformStepDevice = useMemo(
    () => devices.find((d) => d.connectionType === PLATFORM_STEP_SOURCE),
    [devices]
  );

  function handleUnpair(device) {
    showAlert(`Unpair ${device.name}?`, 'Readings already synced from this device are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          try {
            await unpairDevice(device.id);
            await load();
          } catch (err) {
            showAlert('Could not unpair device', err.message);
          }
        },
      },
    ]);
  }

  async function handleSync(device) {
    setSyncingDeviceId(device.id);
    try {
      if (device.connectionType === 'ble') {
        const readings = await connectAndSync(device.bluetoothId, device.deviceType, {
          miScale: /mi\s*scale|mibfs|mibcs/i.test(device.name || ''),
        });
        if (readings.length === 0) {
          showAlert('No new readings', 'The device didn’t send any readings this time. Take a measurement and try again.');
          return;
        }
        const result = await syncDeviceReadings(device.id, readings);
        showAlert('Synced', `${result.synced} new reading${result.synced === 1 ? '' : 's'} added.`);
      } else {
        const days = await fetchDailyStepsSince();
        for (const day of days) {
          await logActivity({ log_date: day.date, steps: day.steps });
        }
        showAlert('Synced', `Steps updated for ${days.length} day${days.length === 1 ? '' : 's'}.`);
      }
      await load();
    } catch (err) {
      showAlert('Sync failed', err.message);
    } finally {
      setSyncingDeviceId(null);
    }
  }

  async function handlePairPlatformSteps() {
    try {
      if (!isStepSyncAvailable()) {
        showAlert(
          `${PLATFORM_STEP_LABEL} isn’t available in this build`,
          'This needs a custom dev client build with the health module linked (see the README).'
        );
        return;
      }
      const { device } = await pairDevice({
        deviceType: 'step_tracker',
        connectionType: PLATFORM_STEP_SOURCE,
        name: PLATFORM_STEP_LABEL,
      });
      await handleSync(device);
    } catch (err) {
      showAlert('Could not connect', err.message);
    }
  }

  function handleScanned(deviceType) {
    if (!isBleAvailable()) {
      showAlert(
        'Bluetooth isn’t available in this build',
        'This needs a custom dev client build with react-native-ble-plx linked (see the README).'
      );
      return;
    }
    setScanDeviceType(deviceType);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={styles.centered} color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>
          Pair a Bluetooth glucose meter, blood pressure monitor, or smart scale to sync readings automatically, or
          connect {PLATFORM_STEP_LABEL} to bring in your step count.
        </Text>

        {devices.length > 0 && (
          <View style={styles.section}>
            <Text style={typography.heading}>Paired devices</Text>
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onRename={setRenamingDevice}
                onUnpair={handleUnpair}
                onSync={handleSync}
                syncing={syncingDeviceId === device.id}
              />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={typography.heading}>Add a device</Text>
          {Object.entries(DEVICE_PROFILES).map(([deviceType, profile]) => (
            <TouchableOpacity key={deviceType} style={[styles.card, styles.addRow]} onPress={() => handleScanned(deviceType)}>
              <Text style={styles.deviceIcon}>{DEVICE_TYPE_ICON[deviceType]}</Text>
              <View style={styles.deviceRowText}>
                <Text style={typography.body}>{profile.label}</Text>
                <Text style={typography.caption} numberOfLines={1}>{profile.examples.join(', ')}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
          {PLATFORM_STEP_SOURCE && !pairedPlatformStepDevice && (
            <TouchableOpacity style={[styles.card, styles.addRow]} onPress={handlePairPlatformSteps}>
              <Text style={styles.deviceIcon}>{DEVICE_TYPE_ICON.step_tracker}</Text>
              <View style={styles.deviceRowText}>
                <Text style={typography.body}>{PLATFORM_STEP_LABEL}</Text>
                <Text style={typography.caption}>Step count from {Platform.OS === 'ios' ? 'Apple Watch / iPhone' : 'Samsung / Wear OS watches'}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        </View>

        {Object.keys(READING_TYPE_LABEL).map((readingType) => (
          <VitalSummaryCard
            key={readingType}
            readingType={readingType}
            reading={vitalsSummary[readingType]}
            history={vitalsHistory[readingType] || []}
          />
        ))}
      </ScrollView>

      <ScanModal
        visible={scanDeviceType !== null}
        deviceType={scanDeviceType}
        onClose={() => setScanDeviceType(null)}
        onPaired={async (device) => {
          setScanDeviceType(null);
          await load();
          await handleSync(device);
        }}
      />

      <RenameModal
        device={renamingDevice}
        onClose={() => setRenamingDevice(null)}
        onRenamed={async () => {
          setRenamingDevice(null);
          await load();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    ...cardShadow,
  },
  deviceRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    ...cardShadow,
  },
  deviceRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deviceIcon: {
    fontSize: 24,
  },
  deviceRowText: {
    flex: 1,
    gap: 2,
  },
  deviceRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  smallAction: {
    paddingVertical: 4,
  },
  smallActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  dangerText: {
    color: colors.danger,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
  },
  vitalCard: {
    gap: spacing.xs,
  },
  vitalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vitalValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  classificationPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  classificationText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  miniChart: {
    marginTop: spacing.xs,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalClose: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  scanStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    color: colors.danger,
  },
  scanList: {
    gap: spacing.sm,
  },
  scanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pairLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
  renameOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  renameCard: {
    gap: spacing.md,
  },
  renameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
  },
  renameActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
