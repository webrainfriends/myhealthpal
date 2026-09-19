import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import PrimaryButton from '../components/PrimaryButton';
import ReportCard from '../components/ReportCard';
import { colors, spacing, typography } from '../theme/theme';
import { fetchReports, fetchSupportedFormats, uploadReport } from '../api/client';

const POLL_INTERVAL_MS = 3000;

export default function UploadScreen({ navigation }) {
  const [supportedFormats, setSupportedFormats] = useState([]);
  const [maxUploadBytes, setMaxUploadBytes] = useState(null);
  const [reports, setReports] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);

  const loadReports = useCallback(async () => {
    try {
      const data = await fetchReports();
      setReports(data.reports);
    } catch (err) {
      // Non-fatal: the list will refresh on the next poll.
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
    loadReports();
    const interval = setInterval(loadReports, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadReports]);

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadReport(file);
      await loadReports();
    } catch (err) {
      Alert.alert('Upload failed', err.message);
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
    handleUpload({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to select a scanned report.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleUpload({ uri: asset.uri, name: asset.fileName || 'report.jpg', mimeType: asset.mimeType || 'image/jpeg' });
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Camera access is required to capture a report.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync();
    if (result.canceled) return;
    const asset = result.assets[0];
    handleUpload({ uri: asset.uri, name: asset.fileName || 'report.jpg', mimeType: asset.mimeType || 'image/jpeg' });
  }

  const maxUploadMb = maxUploadBytes ? Math.round(maxUploadBytes / (1024 * 1024)) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={reports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <Text style={typography.title}>Upload a health report</Text>
            <Text style={[typography.bodySecondary, styles.subtitle]}>
              PDF, JPG/PNG scans, DOCX, CSV, XLS, and XLSX are supported
              {maxUploadMb ? ` — up to ${maxUploadMb}MB per file` : ''}.
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
              <PrimaryButton title="Choose a file" onPress={pickDocument} loading={uploading} />
              <PrimaryButton title="Photo library" variant="secondary" onPress={pickFromLibrary} loading={uploading} />
              <PrimaryButton title="Take a photo" variant="secondary" onPress={takePhoto} loading={uploading} />
            </View>

            <Text style={[typography.heading, styles.sectionHeading]}>Your reports</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ReportCard report={item} onPress={() => navigation.navigate('ReportDetail', { reportId: item.id })} />
        )}
        ListEmptyComponent={
          !loadingReports && (
            <Text style={[typography.bodySecondary, styles.empty]}>
              No reports yet. Upload your first one above.
            </Text>
          )
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
  listContent: {
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
    marginBottom: spacing.lg,
  },
  sectionHeading: {
    marginBottom: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
