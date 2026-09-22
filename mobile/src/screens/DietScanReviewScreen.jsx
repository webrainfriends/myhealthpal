import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FoodEntryForm from '../components/FoodEntryForm';
import PrimaryButton from '../components/PrimaryButton';
import StatusBadge from '../components/StatusBadge';
import { colors, radii, spacing, typography } from '../theme/theme';
import {
  confirmFoodEntry,
  deleteFoodEntry,
  estimateFoodNutrition,
  fetchDietScan,
  retryDietScan,
  updateFoodEntry,
} from '../api/client';
import { showAlert } from '../utils/alert';

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

function CandidateCard({ entry, onChange, onConfirm, onDiscard, busy }) {
  const [local, setLocal] = useState(entry);
  const [estimating, setEstimating] = useState(false);
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
      if (Object.keys(edits).length > 0) onChange(entry.id, edits);
    }, EDIT_DEBOUNCE_MS);
  }

  // Most useful right after typing in the quantity the photo couldn't
  // judge (needs_quantity) - re-estimates nutrition for the name the scan
  // already identified, now scaled to that quantity, the same estimator a
  // manual entry uses.
  async function handleEstimate() {
    if (!local.name || !local.name.trim()) return;
    setEstimating(true);
    try {
      const result = await estimateFoodNutrition({
        name: local.name,
        brand: local.brand || undefined,
        quantity_amount: local.quantity_amount ?? undefined,
        quantity_unit: local.quantity_unit || undefined,
      });
      if (!result.recognized) {
        showAlert('Could not identify this food', `"${local.name}" wasn't recognized - enter the nutrition details manually.`);
        return;
      }
      const { recognized, matched_food_description, confidence, ...patch } = result;
      handleChange({ ...local, ...patch, needs_quantity: false });
    } catch (err) {
      showAlert('Could not estimate nutrition', err.message);
    } finally {
      setEstimating(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={typography.heading}>{local.name || 'Unnamed item'}</Text>
        {(local.needs_quantity || local.needs_review) && <StatusBadge status="Needs Review" />}
      </View>
      <FoodEntryForm value={local} onChange={handleChange} onEstimate={handleEstimate} estimating={estimating} />
      <View style={styles.cardActions}>
        <PrimaryButton title="Confirm" onPress={() => onConfirm(entry.id)} loading={busy} />
        <PrimaryButton title="Discard" variant="secondary" onPress={() => onDiscard(entry.id)} loading={busy} />
      </View>
    </View>
  );
}

export default function DietScanReviewScreen({ route, navigation }) {
  const { scanId } = route.params;
  const [scan, setScan] = useState(null);
  const [entries, setEntries] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const data = await fetchDietScan(scanId);
    setScan(data.scan);
    setEntries(data.entries);
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
        console.warn('Failed to load diet scan', err.message);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  async function handleFieldChange(entryId, edits) {
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...edits } : e)));
    try {
      await updateFoodEntry(entryId, edits);
    } catch (err) {
      showAlert('Could not save edit', err.message);
    }
  }

  async function handleConfirm(entryId) {
    setBusyId(entryId);
    try {
      await confirmFoodEntry(entryId);
      const remaining = entries.filter((e) => e.id !== entryId);
      setEntries(remaining);
      if (remaining.length === 0) navigation.navigate('Diet');
    } catch (err) {
      showAlert('Could not confirm item', err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(entryId) {
    setBusyId(entryId);
    try {
      await deleteFoodEntry(entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      showAlert('Could not discard item', err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry() {
    try {
      await retryDietScan(scanId);
      await load();
    } catch (err) {
      showAlert('Could not retry processing', err.message);
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
            Identifying what's in your photo… this updates automatically.
          </Text>
        )}

        {scan.processing_error && (
          <View style={styles.errorBox}>
            <Text style={[typography.body, styles.errorText]}>{scan.processing_error}</Text>
          </View>
        )}

        {scan.ingestion_status === 'Failed' && <PrimaryButton title="Retry processing" onPress={handleRetry} />}

        {scan.ingestion_status === 'Completed' && entries.length === 0 && !scan.processing_error && (
          <Text style={typography.bodySecondary}>No food or drink was identified in this photo.</Text>
        )}

        {entries.length > 0 && (
          <Text style={[typography.bodySecondary, styles.reviewNote]}>
            Check the details below - especially quantity, where flagged - then confirm each item to log it.
          </Text>
        )}

        {entries.map((entry) => (
          <CandidateCard
            key={entry.id}
            entry={entry}
            onChange={handleFieldChange}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
            busy={busyId === entry.id}
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
