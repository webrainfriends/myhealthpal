import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MedicationForm from '../components/MedicationForm';
import PrimaryButton from '../components/PrimaryButton';
import StatusBadge from '../components/StatusBadge';
import { colors, radii, spacing, typography } from '../theme/theme';
import { confirmMedication, deleteMedication, fetchMedicationScan, retryMedicationScan, updateMedication } from '../api/client';

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

function CandidateCard({ medication, onChange, onConfirm, onDiscard, busy }) {
  const [local, setLocal] = useState(medication);
  const pendingEdits = useRef({});
  const debounceTimer = useRef(null);

  function handleChange(next) {
    const changed = {};
    for (const key of Object.keys(next)) {
      if (next[key] !== local[key]) changed[key] = next[key];
    }
    setLocal(next);
    pendingEdits.current = { ...pendingEdits.current, ...changed };

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const edits = pendingEdits.current;
      pendingEdits.current = {};
      if (Object.keys(edits).length > 0) onChange(medication.id, edits);
    }, EDIT_DEBOUNCE_MS);
  }

  return (
    <View style={[styles.card]}>
      <View style={styles.cardHeader}>
        <Text style={typography.heading}>{local.name || 'Unnamed medication'}</Text>
        {local.needs_review && <StatusBadge status="Needs Review" />}
      </View>
      <MedicationForm value={local} onChange={handleChange} />
      <View style={styles.cardActions}>
        <PrimaryButton title="Confirm" onPress={() => onConfirm(medication.id)} loading={busy} />
        <PrimaryButton title="Discard" variant="secondary" onPress={() => onDiscard(medication.id)} loading={busy} />
      </View>
    </View>
  );
}

export default function MedicationScanReviewScreen({ route, navigation }) {
  const { scanId } = route.params;
  const [scan, setScan] = useState(null);
  const [medications, setMedications] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const data = await fetchMedicationScan(scanId);
    setScan(data.scan);
    setMedications(data.medications);
    return data.scan.ingestion_status;
  }, [scanId]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function tick() {
      try {
        const status = await load();
        if (!cancelled && POLL_STATUSES.has(status)) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.warn('Failed to load medication scan', err.message);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  async function handleFieldChange(medicationId, edits) {
    setMedications((prev) => prev.map((m) => (m.id === medicationId ? { ...m, ...edits } : m)));
    try {
      await updateMedication(medicationId, edits);
    } catch (err) {
      Alert.alert('Could not save edit', err.message);
    }
  }

  async function handleConfirm(medicationId) {
    setBusyId(medicationId);
    try {
      await confirmMedication(medicationId);
      const remaining = medications.filter((m) => m.id !== medicationId);
      setMedications(remaining);
      if (remaining.length === 0) navigation.navigate('MedicationsTab');
      else navigation.navigate('MedicationDetail', { medicationId });
    } catch (err) {
      Alert.alert('Could not confirm medication', err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(medicationId) {
    setBusyId(medicationId);
    try {
      await deleteMedication(medicationId);
      setMedications((prev) => prev.filter((m) => m.id !== medicationId));
    } catch (err) {
      Alert.alert('Could not discard medication', err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry() {
    try {
      await retryMedicationScan(scanId);
      await load();
    } catch (err) {
      Alert.alert('Could not retry processing', err.message);
    }
  }

  if (!scan) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const isProcessing = POLL_STATUSES.has(scan.ingestion_status);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={typography.title}>Review scan</Text>
          <StatusBadge status={scan.ingestion_status} />
        </View>

        {isProcessing && (
          <Text style={[typography.bodySecondary, styles.processingNote]}>
            Reading your {scan.scan_type === 'tablet_photo' ? 'tablet photo' : 'prescription'}… this updates automatically.
          </Text>
        )}

        {scan.processing_error && (
          <View style={styles.errorBox}>
            <Text style={[typography.body, styles.errorText]}>{scan.processing_error}</Text>
          </View>
        )}

        {scan.ingestion_status === 'Failed' && <PrimaryButton title="Retry processing" onPress={handleRetry} />}

        {scan.ingestion_status === 'Completed' && medications.length === 0 && !scan.processing_error && (
          <Text style={typography.bodySecondary}>No medicines were found in this scan.</Text>
        )}

        {medications.length > 0 && (
          <Text style={[typography.bodySecondary, styles.reviewNote]}>
            Check the details below, correct anything the scan got wrong, then confirm each medicine to start tracking it.
          </Text>
        )}

        {medications.map((medication) => (
          <CandidateCard
            key={medication.id}
            medication={medication}
            onChange={handleFieldChange}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
            busy={busyId === medication.id}
          />
        ))}
      </ScrollView>
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
    gap: spacing.md,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  processingNote: {
    fontStyle: 'italic',
  },
  reviewNote: {},
  errorBox: {
    backgroundColor: colors.dangerMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
