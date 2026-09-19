import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusBadge from '../components/StatusBadge';
import ParameterRow from '../components/ParameterRow';
import PrimaryButton from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme/theme';
import { confirmReport, fetchReport, retryReport, updateParameter } from '../api/client';

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

export default function ReportDetailScreen({ route, navigation }) {
  const { reportId } = route.params;
  const [report, setReport] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [busy, setBusy] = useState(false);
  const pendingEdits = useRef({});
  const debounceTimers = useRef({});

  const load = useCallback(async () => {
    const data = await fetchReport(reportId);
    setReport(data.report);
    setParameters(data.parameters);
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

  function handleParameterChange(parameterId, changes) {
    setParameters((prev) => prev.map((p) => (p.id === parameterId ? { ...p, ...changes } : p)));
    pendingEdits.current[parameterId] = { ...pendingEdits.current[parameterId], ...changes };

    if (debounceTimers.current[parameterId]) clearTimeout(debounceTimers.current[parameterId]);
    debounceTimers.current[parameterId] = setTimeout(async () => {
      const edits = pendingEdits.current[parameterId];
      delete pendingEdits.current[parameterId];
      try {
        await updateParameter(reportId, parameterId, edits);
      } catch (err) {
        Alert.alert('Could not save edit', err.message);
      }
    }, EDIT_DEBOUNCE_MS);
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

        {parameters.length > 0 && (
          <View style={styles.section}>
            <Text style={[typography.heading, styles.sectionHeading]}>
              Extracted parameters {isEditable ? '(tap a field to correct it)' : ''}
            </Text>
            {parameters.map((parameter) => (
              <ParameterRow
                key={parameter.id}
                parameter={parameter}
                editable={isEditable}
                onChange={(changes) => handleParameterChange(parameter.id, changes)}
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
  section: {
    gap: spacing.sm,
  },
  sectionHeading: {
    marginBottom: spacing.xs,
  },
});
