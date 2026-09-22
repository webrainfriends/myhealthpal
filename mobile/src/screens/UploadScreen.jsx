import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import PrimaryButton from '../components/PrimaryButton';
import StatusBadge from '../components/StatusBadge';
import { cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchReports, fetchSupportedFormats, uploadReport } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';

function formatDate(value, t) {
  if (!value) return t('upload.datePending');
  return formatCalendarDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
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

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadReport(file);
      await loadReports();
      showAlert(t('upload.uploaded'), t('upload.uploadedMessage'));
    } catch (err) {
      showAlert(t('upload.uploadFailed'), err.message);
    } finally {
      setUploading(false);
    }
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleUpload({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file });
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
      name: asset.fileName || 'report.jpg',
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
      name: asset.fileName || 'report.jpg',
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

            <View style={styles.actions}>
              <PrimaryButton title={t('upload.chooseFile')} onPress={pickDocument} loading={uploading} />
              <PrimaryButton title={t('upload.photoLibrary')} variant="secondary" onPress={pickFromLibrary} loading={uploading} />
              <PrimaryButton title={t('upload.takePhoto')} variant="secondary" onPress={takePhoto} loading={uploading} />
            </View>

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
  actions: {
    gap: spacing.sm,
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
