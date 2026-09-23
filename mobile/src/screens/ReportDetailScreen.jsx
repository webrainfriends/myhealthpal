import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StatusBadge from '../components/StatusBadge';
import MeasurementRow from '../components/MeasurementRow';
import PrimaryButton from '../components/PrimaryButton';
import SpeakButton from '../components/SpeakButton';
import { colors, radii, spacing, typography } from '../theme/theme';
import {
  confirmReport,
  deleteReport,
  fetchReport,
  fetchReportFileUrl,
  resolveDuplicateMeasurement,
  retryReport,
  updateMeasurement,
  updateReportDate,
} from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';

function formatDate(value) {
  return formatCalendarDate(value, { year: 'numeric', month: 'long', day: 'numeric' });
}

function truncateFilename(name, maxLength = 28) {
  if (name.length <= maxLength) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > -1 ? name.slice(dot) : '';
  const base = dot > -1 ? name.slice(0, dot) : name;
  return `${base.slice(0, Math.max(1, maxLength - extension.length - 1))}…${extension}`;
}

// Builds the sentence SpeakButton reads for the whole report: the summary
// (or a synthesized one when no narrative exists yet) followed by every
// extracted measurement read as "name: value unit, flag" - so a person
// using Voice Mode gets the same result data a sighted user reads off the
// measurement rows below, not just the free-text summary.
function buildReportSpeech(report, measurements, narrativeSummary, t) {
  const parts = [];
  const summary = narrativeSummary?.summary_text || report.generated_summary;
  if (summary) parts.push(summary);
  for (const m of measurements) {
    const name = m.parameter_display_name || m.raw_test_name;
    const value = [m.raw_value, m.raw_unit].filter(Boolean).join(' ');
    const flag = m.status_flag ? `, ${m.status_flag}` : '';
    parts.push(`${name}: ${value}${flag}.`);
  }
  return parts.join(' ');
}

function EffectiveDateRow({ report, onSave, t }) {
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
          <Text style={styles.dateSaveLabel}>{t('reportDetail.save')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={() => setEditing(true)} style={styles.dateRow}>
      <Text style={typography.heading}>
        {report.effective_date ? formatDate(report.effective_date) : t('reportDetail.dateNeedsReview')}
      </Text>
      <Text style={styles.dateEditLabel}>
        {report.date_status === 'Confirmed' ? t('reportDetail.edit') : t('reportDetail.setDate')}
      </Text>
    </TouchableOpacity>
  );
}

const POLL_STATUSES = new Set(['Uploaded', 'Processing']);
const POLL_INTERVAL_MS = 2000;
const EDIT_DEBOUNCE_MS = 600;

export default function ReportDetailScreen({ route, navigation }) {
  const { reportId } = route.params;
  const t = useT();
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
    navigation.setOptions({ title: report?.original_filename || t('nav.report') });
  }, [navigation, report?.original_filename, t]);

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
        showAlert(t('reportDetail.couldNotSaveEdit'), err.message);
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
      showAlert(t('reportDetail.couldNotUpdateMapping'), err.message);
    }
  }

  async function handleResolveDuplicate(measurementId, action) {
    try {
      const data = await resolveDuplicateMeasurement(reportId, measurementId, action);
      setMeasurements((prev) => prev.map((m) => (m.id === measurementId ? data.measurement : m)));
    } catch (err) {
      showAlert(t('reportDetail.couldNotUpdateDuplicate'), err.message);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const data = await confirmReport(reportId);
      setReport(data.report);
    } catch (err) {
      showAlert(t('reportDetail.couldNotConfirm'), err.message);
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
      showAlert(t('reportDetail.couldNotOpenFile'), err.message);
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
      showAlert(t('reportDetail.couldNotRetry'), err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDateSave(value) {
    try {
      await updateReportDate(reportId, value);
      await load();
    } catch (err) {
      showAlert(t('reportDetail.couldNotUpdateDate'), err.message);
    }
  }

  function handleDelete() {
    showAlert(
      t('reportDetail.deleteConfirmTitle'),
      t('reportDetail.deleteConfirmMessage', { name: report.original_filename }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReport(reportId);
              // See MedicationDetailScreen's handleDelete for why goBack()
              // alone isn't safe: this screen is also reachable with no
              // prior in-app history (a deep link, a bookmark, a refresh).
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Timeline');
              }
            } catch (err) {
              showAlert(t('reportDetail.couldNotDelete'), err.message);
            }
          },
        },
      ]
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('reportDetail.loading')}</Text>
      </SafeAreaView>
    );
  }

  const isProcessing = POLL_STATUSES.has(report.ingestion_status);
  const isEditable = report.ingestion_status === 'Needs Review';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <EffectiveDateRow report={report} onSave={handleDateSave} t={t} />
          <View style={styles.headerActions}>
            <SpeakButton
              text={buildReportSpeech(report, measurements, narrativeSummary, t)}
              label={t('reportDetail.readAloud')}
            />
            <StatusBadge status={report.ingestion_status} />
          </View>
        </View>

        <PrimaryButton
          title={
            report.original_filename
              ? t('reportDetail.viewOriginal', { name: truncateFilename(report.original_filename) })
              : t('reportDetail.viewOriginalFile')
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
            <Text style={[typography.heading, styles.alertHeading]}>{t('reportDetail.alerts')}</Text>
            {report.alerts.split('\n').map((alert, i) => (
              <Text key={i} style={[typography.body, styles.alertText]}>
                {alert}
              </Text>
            ))}
          </View>
        )}

        {isProcessing && (
          <Text style={[typography.bodySecondary, styles.processingNote]}>{t('reportDetail.processingNote')}</Text>
        )}

        {report.processing_error && (
          <View style={styles.errorBox}>
            <Text style={[typography.body, styles.errorText]}>{report.processing_error}</Text>
          </View>
        )}

        {(narrativeSummary?.summary_text || report.generated_summary) && (
          <View style={styles.summaryBox}>
            <Text style={typography.heading}>{t('reportDetail.summary')}</Text>
            <Text style={[typography.bodySecondary, styles.summaryText]}>
              {narrativeSummary?.summary_text || report.generated_summary}
            </Text>
          </View>
        )}

        {report.notes && (
          <View style={styles.notesBox}>
            <Text style={typography.heading}>{t('reportDetail.notes')}</Text>
            {report.notes.split('\n').map((note, i) => (
              <Text key={i} style={[typography.bodySecondary, styles.notesText]}>
                {note}
              </Text>
            ))}
          </View>
        )}

        {measurements.some((m) => m.duplicate_status === 'suspected') && (
          <View style={styles.duplicateBanner}>
            <Text style={[typography.body, styles.duplicateBannerText]}>{t('reportDetail.duplicateWarning')}</Text>
          </View>
        )}

        {measurements.length > 0 && (
          <View style={styles.section}>
            <Text style={[typography.heading, styles.sectionHeading]}>
              {t('reportDetail.extractedParameters')} {isEditable ? t('reportDetail.tapToCorrect') : ''}
            </Text>
            {measurements.map((measurement) => (
              <MeasurementRow
                key={measurement.id}
                measurement={measurement}
                editable={isEditable}
                onChange={(changes) => handleMeasurementChange(measurement.id, changes)}
                onChangeMapping={(healthParameterId) => handleMappingChange(measurement.id, healthParameterId)}
                onResolveDuplicate={(action) => handleResolveDuplicate(measurement.id, action)}
              />
            ))}
          </View>
        )}

        {isEditable && <PrimaryButton title={t('reportDetail.confirmReport')} onPress={handleConfirm} loading={busy} />}

        {(report.ingestion_status === 'Failed' || isEditable) && (
          <PrimaryButton
            title={t('reportDetail.reprocessFile')}
            variant="secondary"
            onPress={handleRetry}
            loading={busy}
          />
        )}

        <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
          <Text style={styles.deleteLabel}>{t('reportDetail.deleteReport')}</Text>
        </TouchableOpacity>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  deleteButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  deleteLabel: {
    color: colors.danger,
    fontWeight: '600',
  },
});
