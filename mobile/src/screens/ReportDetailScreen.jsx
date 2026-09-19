import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusBadge from '../components/StatusBadge';
import MeasurementRow from '../components/MeasurementRow';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { confirmReport, fetchReport, retryReport, updateMeasurement } from '../api/client';

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

export default function ReportDetailScreen({ route, navigation }) {
  const { reportId } = route.params;
  const [report, setReport] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [busy, setBusy] = useState(false);
  const pendingEdits = useRef({});
  const debounceTimers = useRef({});

  const load = useCallback(async () => {
    const data = await fetchReport(reportId);
    setReport(data.report);
    setMeasurements(data.measurements);
    return data.report.ingestion_status;
  }, [reportId]);

  useEffect(() => {
    navigation.setOptions({ title: report?.original_filename || 'Report' });
  }, [navigation, report?.original_filename]);

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
        console.warn('Failed to load report', err.message);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  function handleMeasurementChange(measurementId, changes) {
    setMeasurements((prev) => prev.map((m) => (m.id === measurementId ? { ...m, ...changes } : m)));
    pendingEdits.current[measurementId] = { ...pendingEdits.current[measurementId], ...changes };

    if (debounceTimers.current[measurementId]) clearTimeout(debounceTimers.current[measurementId]);
    debounceTimers.current[measurementId] = setTimeout(async () => {
      const edits = pendingEdits.current[measurementId];
      delete pendingEdits.current[measurementId];
      try {
        await updateMeasurement(reportId, measurementId, edits);
      } catch (err) {
        Alert.alert('Could not save edit', err.message);
      }
    }, EDIT_DEBOUNCE_MS);
  }

  async function handleMappingChange(measurementId, healthParameterId) {
    try {
      await updateMeasurement(reportId, measurementId, { health_parameter_id: healthParameterId });
      // The measurement list join (parameter display name/category) only
      // comes from the report GET, so refresh from there rather than
      // patching local state with the bare row the PATCH response returns.
      await load();
    } catch (err) {
      Alert.alert('Could not update mapping', err.message);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const data = await confirmReport(reportId);
      setReport(data.report);
    } catch (err) {
      Alert.alert('Could not confirm report', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    setBusy(true);
    try {
      await retryReport(reportId);
      await load();
    } catch (err) {
      Alert.alert('Could not retry processing', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading report…</Text>
      </SafeAreaView>
    );
  }

  const isProcessing = POLL_STATUSES.has(report.ingestion_status);
  const isEditable = report.ingestion_status === 'Needs Review';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <StatusBadge status={report.ingestion_status} />
        </View>

        {isProcessing && (
          <Text style={[typography.bodySecondary, styles.processingNote]}>
            We're processing this report. This screen updates automatically.
          </Text>
        )}

        {report.processing_error && (
          <View style={styles.errorBox}>
            <Text style={[typography.body, styles.errorText]}>{report.processing_error}</Text>
          </View>
        )}

        {report.generated_summary && (
          <View style={styles.summaryBox}>
            <Text style={typography.heading}>Summary</Text>
            <Text style={[typography.bodySecondary, styles.summaryText]}>{report.generated_summary}</Text>
          </View>
        )}

        {measurements.some((m) => m.duplicate_status === 'suspected') && (
          <View style={styles.duplicateBanner}>
            <Text style={[typography.body, styles.duplicateBannerText]}>
              Some values look like they may already be recorded from an earlier confirmed report — check the
              highlighted rows below.
            </Text>
          </View>
        )}

        {measurements.length > 0 && (
          <View style={styles.section}>
            <Text style={[typography.heading, styles.sectionHeading]}>
              Extracted parameters {isEditable ? '(tap a field to correct it)' : ''}
            </Text>
            {measurements.map((measurement) => (
              <MeasurementRow
                key={measurement.id}
                measurement={measurement}
                editable={isEditable}
                onChange={(changes) => handleMeasurementChange(measurement.id, changes)}
                onChangeMapping={(healthParameterId) => handleMappingChange(measurement.id, healthParameterId)}
              />
            ))}
          </View>
        )}

        {report.ingestion_status === 'Failed' && (
          <PrimaryButton title="Retry processing" onPress={handleRetry} loading={busy} />
        )}

        {isEditable && (
          <PrimaryButton title="Confirm report" onPress={handleConfirm} loading={busy} />
        )}
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
  },
  processingNote: {
    fontStyle: 'italic',
  },
  errorBox: {
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  summaryBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryText: {},
  duplicateBanner: {
    backgroundColor: colors.warningMuted,
    borderRadius: 12,
    padding: spacing.md,
  },
  duplicateBannerText: {
    color: colors.warning,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeading: {
    marginBottom: spacing.xs,
  },
});
