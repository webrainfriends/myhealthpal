import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import ChipSelect from '../components/ChipSelect';
import PrimaryButton from '../components/PrimaryButton';
import StatusBadge from '../components/StatusBadge';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  fetchDietScan,
  fetchDietScheduleImport,
  fetchInsurancePolicy,
  fetchReports,
  fetchSupportedFormats,
  uploadSmart,
} from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { openPrivacyIfConsentNeeded } from '../utils/consent';
import { formatCalendarDate } from '../utils/date';

function formatDate(value, t) {
  if (!value) return t('upload.datePending');
  return formatCalendarDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

// What each kind of upload becomes, and what to show while it is read.
const CATEGORY_ICONS = { lab_report: '🧪', insurance: '🛡️', food: '🍽️', diet_schedule: '🗓️' };
const CATEGORY_LABEL_KEYS = {
  lab_report: 'upload.type.lab_report',
  insurance: 'upload.type.insurance',
  food: 'upload.type.food',
  diet_schedule: 'upload.type.diet_schedule',
};
const POLL_MS = 3000;
const MAX_POLLS = 40;

// One poll of a just-uploaded item: has the server finished reading it? A lab
// report is handled by the "Your reports" list below, so it is ready at once.
async function checkProgress(result) {
  try {
    if (result.category === 'insurance') {
      const { policy } = await fetchInsurancePolicy(result.recordId);
      if (policy.ingestionStatus === 'Failed') return { status: 'failed', error: policy.processingError };
      if (policy.ingestionStatus === 'Processing' || policy.ingestionStatus === 'Uploaded') return { status: 'processing' };
      return { status: 'ready' };
    }
    if (result.category === 'diet_schedule') {
      const data = await fetchDietScheduleImport(result.recordId);
      if (data.scheduleId) return { status: 'ready', scheduleId: data.scheduleId };
      if (data.import.ingestionStatus === 'Failed') return { status: 'failed', error: data.import.processingError };
      return { status: 'processing' };
    }
    if (result.category === 'food') {
      const { scan } = await fetchDietScan(result.recordId);
      if (scan.ingestion_status === 'Failed') return { status: 'failed', error: scan.processing_error };
      if (scan.ingestion_status === 'Processing' || scan.ingestion_status === 'Uploaded') return { status: 'processing' };
      return { status: 'ready' };
    }
  } catch (err) {
    return { status: 'processing' };
  }
  return { status: 'ready' };
}

function ResultRow({ result, onPress, t }) {
  const label = t(CATEGORY_LABEL_KEYS[result.category]);
  const statusText =
    result.status === 'failed'
      ? result.error || t('upload.couldNotRead')
      : result.status === 'processing'
        ? t('upload.reading')
        : t('upload.readyToOpen');
  const statusColor = result.status === 'failed' ? colors.danger : result.status === 'ready' ? colors.success : colors.primary;
  return (
    <TouchableOpacity style={[styles.reportRow, cardShadow]} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <Text style={styles.resultIcon}>{CATEGORY_ICONS[result.category]}</Text>
      <View style={styles.reportRowMain}>
        <Text style={typography.body} numberOfLines={1}>
          {result.name}
        </Text>
        <Text style={typography.caption}>
          {result.method === 'user' ? t('upload.filedAsChosen', { type: label }) : t('upload.filedAs', { type: label })}
        </Text>
        <Text style={[typography.caption, { color: statusColor, fontWeight: '700' }]} numberOfLines={2}>
          {statusText}
        </Text>
        {result.uncertain ? <Text style={styles.uncertain}>{t('upload.notSure')}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function ReportRow({ report, onPress, t }) {
  return (
    <TouchableOpacity style={[styles.reportRow, cardShadow]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.reportRowMain}>
        <Text style={typography.body} numberOfLines={1}>
          {report.original_filename}
        </Text>
        <Text style={typography.caption}>{formatDate(report.effective_date, t)}</Text>
      </View>
      <StatusBadge status={report.ingestion_status} />
    </TouchableOpacity>
  );
}

export default function UploadScreen({ navigation }) {
  const t = useT();
  const [supportedFormats, setSupportedFormats] = useState([]);
  const [maxUploadBytes, setMaxUploadBytes] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);
  // 'auto' lets the server work out what each file is; the other values are
  // the person's own choice and are never second-guessed.
  const [category, setCategory] = useState('auto');
  const [results, setResults] = useState([]);
  const pollCounts = useRef({});

  const loadReports = useCallback(async () => {
    try {
      const data = await fetchReports();
      setReports(data.reports);
    } catch (err) {
      console.warn('Failed to load reports', err.message);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    fetchSupportedFormats()
      .then((data) => {
        setSupportedFormats(data.extensions);
        setMaxUploadBytes(data.maxUploadBytes);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadReports);
    return unsubscribe;
  }, [navigation, loadReports]);

  // Items the server is still reading (a policy, a schedule, a food photo)
  // are checked every few seconds until they finish or fail.
  const hasProcessing = results.some((r) => r.status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      const pending = results.filter((r) => r.status === 'processing');
      const updates = await Promise.all(
        pending.map(async (r) => {
          pollCounts.current[r.key] = (pollCounts.current[r.key] || 0) + 1;
          if (pollCounts.current[r.key] > MAX_POLLS) return { key: r.key, status: 'ready' };
          return { key: r.key, ...(await checkProgress(r)) };
        })
      );
      if (cancelled) return;
      setResults((current) =>
        current.map((r) => {
          const update = updates.find((u) => u.key === r.key);
          return update && update.status !== 'processing' ? { ...r, ...update } : r;
        })
      );
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasProcessing, results]);

  // Uploads files one at a time (each is filed on its own, and a failure in
  // one shouldn't lose the rest), then reports a single combined result.
  async function handleUpload(files) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (list.length === 0) return;
    setUploading(true);
    const failures = [];
    const filed = [];
    try {
      for (const file of list) {
        try {
          const response = await uploadSmart(file, { category });
          filed.push({
            key: `${response.record.id}`,
            name: file.name,
            category: response.category,
            method: response.method,
            uncertain: response.uncertain,
            recordId: response.record.id,
            status: response.category === 'lab_report' ? 'ready' : 'processing',
          });
        } catch (err) {
          if (openPrivacyIfConsentNeeded(err, navigation)) return;
          failures.push(`${file.name}: ${err.message}`);
        }
      }
    } finally {
      setUploading(false);
      if (filed.length > 0) setResults((current) => [...filed, ...current].slice(0, 8));
      await loadReports();
    }
    if (failures.length > 0) {
      showAlert(t('upload.uploadFailed'), failures.join('\n'));
    }
  }

  function openResult(result) {
    switch (result.category) {
      case 'insurance':
        navigation.navigate('InsurancePolicy', { policyId: result.recordId });
        break;
      case 'food':
        navigation.navigate('DietScanReview', { scanId: result.recordId });
        break;
      case 'diet_schedule':
        if (result.scheduleId) navigation.navigate('DietScheduleDetail', { scheduleId: result.scheduleId });
        else if (result.status === 'failed') navigation.navigate('DietSchedules');
        break;
      default:
        navigation.navigate('ReportDetail', { reportId: result.recordId });
    }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      // Apple Health exports arrive as .zip/.xml/.gpx, whose MIME types
      // vary by platform (and are often missing), so don't filter here -
      // the server validates the extension and contents.
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    handleUpload(
      result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file }))
    );
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('common.permissionNeeded'), t('upload.permissionLibrary'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleUpload({
      uri: asset.uri,
      name: asset.fileName || 'photo.jpg',
      mimeType: asset.mimeType || 'image/jpeg',
      file: asset.file,
    });
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('common.permissionNeeded'), t('upload.permissionCamera'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync();
    if (result.canceled) return;
    const asset = result.assets[0];
    handleUpload({
      uri: asset.uri,
      name: asset.fileName || 'photo.jpg',
      mimeType: asset.mimeType || 'image/jpeg',
      file: asset.file,
    });
  }

  const maxUploadMb = maxUploadBytes ? Math.round(maxUploadBytes / (1024 * 1024)) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={typography.title}>{t('upload.title')}</Text>
            <Text style={[typography.bodySecondary, styles.subtitle]}>
              {t('upload.subtitleBase')}
              {maxUploadMb ? t('upload.subtitleMax', { mb: maxUploadMb }) : ''}.
            </Text>
            {supportedFormats.length > 0 && (
              <View style={styles.formatRow}>
                {supportedFormats.map((ext) => (
                  <View key={ext} style={styles.formatPill}>
                    <Text style={styles.formatText}>{ext.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.typeChooser}>
              <ChipSelect
                label={t('upload.whatIsIt')}
                options={[
                  { value: 'auto', label: t('upload.type.auto') },
                  { value: 'lab_report', label: `${CATEGORY_ICONS.lab_report} ${t('upload.type.lab_report')}` },
                  { value: 'insurance', label: `${CATEGORY_ICONS.insurance} ${t('upload.type.insurance')}` },
                  { value: 'food', label: `${CATEGORY_ICONS.food} ${t('upload.type.food')}` },
                  { value: 'diet_schedule', label: `${CATEGORY_ICONS.diet_schedule} ${t('upload.type.diet_schedule')}` },
                ]}
                value={category}
                onChange={(value) => setCategory(value || 'auto')}
                allowClear={false}
              />
              {category === 'auto' ? <Text style={typography.caption}>{t('upload.autoHint')}</Text> : null}
            </View>

            <View style={styles.actions}>
              <PrimaryButton title={t('upload.chooseFile')} onPress={pickDocument} loading={uploading} />
              <PrimaryButton title={t('upload.photoLibrary')} variant="secondary" onPress={pickFromLibrary} loading={uploading} />
              <PrimaryButton title={t('upload.takePhoto')} variant="secondary" onPress={takePhoto} loading={uploading} />
            </View>

            {results.length > 0 ? (
              <View>
                <Text style={[typography.heading, styles.sectionHeading]}>{t('upload.justUploaded')}</Text>
                {results.map((result) => (
                  <ResultRow key={result.key} result={result} t={t} onPress={() => openResult(result)} />
                ))}
              </View>
            ) : null}

            <Text style={[typography.heading, styles.sectionHeading]}>{t('upload.yourReports')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ReportRow report={item} onPress={() => navigation.navigate('ReportDetail', { reportId: item.id })} t={t} />
        )}
        ListEmptyComponent={
          !loadingReports && <Text style={[typography.bodySecondary, styles.empty]}>{t('upload.empty')}</Text>
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
    marginBottom: spacing.md,
  },
  formatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  formatPill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  formatText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  typeChooser: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.sm,
  },
  resultIcon: {
    fontSize: 24,
  },
  chevron: {
    fontSize: 22,
    color: colors.textTertiary,
  },
  uncertain: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
  },
  sectionHeading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  reportRowMain: {
    flex: 1,
    gap: 2,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
