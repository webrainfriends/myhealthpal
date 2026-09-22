import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusBadge from '../components/StatusBadge';
import MeasurementRow from '../components/MeasurementRow';
import PrimaryButton from '../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import {
  confirmReport,
  fetchReport,
  fetchReportFileUrl,
  retryReport,
  updateMeasurement,
  updateReportDate,
} from '../api/client';
import { showAlert } from '../utils/alert';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function truncateFilename(name, maxLength = 28) {
  if (name.length <= maxLength) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > -1 ? name.slice(dot) : '';
  const base = dot > -1 ? name.slice(0, dot) : name;
  return `${base.slice(0, Math.max(1, maxLength - extension.length - 1))}…${extension}`;
}

function EffectiveDateRow({ report, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(report.effective_date ? report.effective_date.slice(0, 10) : '');

  if (editing) {
    return (
      <View style={styles.dateEditRow}>
        <TextInput
          style={styles.dateInput}
          value={value}
          onChangeText={setValue}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textTertiary}
        />
        <TouchableOpacity
          onPress={() => {
            onSave(value);
            setEditing(false);
          }}
        >
          <Text style={styles.dateSaveLabel}>Save</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={() => setEditing(true)} style={styles.dateRow}>
      <Text style={typography.heading}>
        {report.effective_date ? formatDate(report.effective_date) : 'Date needs review'}
      </Text>
      <Text style={styles.dateEditLabel}>{report.date_status === 'Confirmed' ? 'Edit' : 'Set date'}</Text>
    </TouchableOpacity>
  );
}

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

export default function ReportDetailScreen({ route, navigation }) {
  const { reportId } = route.params;
  const [report, setReport] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [narrativeSummary, setNarrativeSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const pendingEdits = useRef({});
  const debounceTimers = useRef({});

  const load = useCallback(async () => {
    const data = await fetchReport(reportId);
    setReport(data.report);
    setMeasurements(data.measurements);
    setNarrativeSummary(data.narrativeSummary);
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
        showAlert('Could not save edit', err.message);
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
      showAlert('Could not update mapping', err.message);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const data = await confirmReport(reportId);
      setReport(data.report);
    } catch (err) {
      showAlert('Could not confirm report', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleViewOriginal() {
    setOpeningFile(true);
    try {
      const url = await fetchReportFileUrl(reportId);
      await Linking.openURL(url);
    } catch (err) {
      showAlert('Could not open original file', err.message);
    } finally {
      setOpeningFile(false);
    }
  }

  async function handleRetry() {
    setBusy(true);
    try {
      await retryReport(reportId);
      await load();
    } catch (err) {
      showAlert('Could not retry processing', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDateSave(value) {
    try {
      await updateReportDate(reportId, value);
      await load();
    } catch (err) {
      showAlert('Could not update date', err.message);
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
          <EffectiveDateRow report={report} onSave={handleDateSave} />
          <StatusBadge status={report.ingestion_status} />
        </View>

        <PrimaryButton
          title={
            report.original_filename
              ? `View original: ${truncateFilename(report.original_filename)}`
              : 'View original file'
          }
          variant="secondary"
          onPress={handleViewOriginal}
          loading={openingFile}
        />

        {(report.source_provider || report.report_type) && (
          <Text style={[typography.bodySecondary, styles.labLine]}>
            {[report.source_provider, report.report_type].filter(Boolean).join(' — ')}
          </Text>
        )}

        {report.alerts && (
          <View style={styles.alertBox}>
            <Text style={[typography.heading, styles.alertHeading]}>Alerts</Text>
            {report.alerts.split('\n').map((alert, i) => (
              <Text key={i} style={[typography.body, styles.alertText]}>
                {alert}
              </Text>
            ))}
          </View>
        )}

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

        {(narrativeSummary?.summary_text || report.generated_summary) && (
          <View style={styles.summaryBox}>
            <Text style={typography.heading}>Summary</Text>
            <Text style={[typography.bodySecondary, styles.summaryText]}>
              {narrativeSummary?.summary_text || report.generated_summary}
            </Text>
          </View>
        )}

        {report.notes && (
          <View style={styles.notesBox}>
            <Text style={typography.heading}>Notes</Text>
            {report.notes.split('\n').map((note, i) => (
              <Text key={i} style={[typography.bodySecondary, styles.notesText]}>
                {note}
              </Text>
            ))}
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

        {isEditable && (
          <PrimaryButton title="Confirm report" onPress={handleConfirm} loading={busy} />
        )}

        {(report.ingestion_status === 'Failed' || isEditable) && (
          <PrimaryButton
            title="Re-process this file"
            variant="secondary"
            onPress={handleRetry}
            loading={busy}
          />
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateEditLabel: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  dateEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 15,
    flex: 1,
    backgroundColor: colors.surface,
  },
  dateSaveLabel: {
    color: colors.primary,
    fontWeight: '600',
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
  labLine: {
    marginTop: -spacing.xs,
  },
  alertBox: {
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  alertHeading: {
    color: colors.danger,
  },
  alertText: {
    color: colors.danger,
  },
  notesBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  notesText: {},
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
