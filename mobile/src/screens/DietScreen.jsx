import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import FoodEntryCard from '../components/FoodEntryCard';
import PrimaryButton from '../components/PrimaryButton';
import { alertSeverityColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  fetchDietEntries,
  fetchDietRecommendations,
  fetchDietSummary,
  uploadDietScan,
} from '../api/client';
import { showAlert } from '../utils/alert';

const MACRO_LABELS = [
  { key: 'protein_g', label: 'Protein', suffix: 'g' },
  { key: 'carbs_g', label: 'Carbs', suffix: 'g' },
  { key: 'fat_g', label: 'Fat', suffix: 'g' },
  { key: 'fiber_g', label: 'Fiber', suffix: 'g' },
  { key: 'sugar_g', label: 'Sugar', suffix: 'g' },
  { key: 'sodium_mg', label: 'Sodium', suffix: 'mg' },
];

// The rest of the AI-estimated nutrients (dietPhotoProvider.js) - tucked
// behind a toggle so the default "Today" card stays a quick glance rather
// than a 12-value nutrition label.
const MICRONUTRIENT_LABELS = [
  { key: 'saturated_fat_g', label: 'Sat. fat', suffix: 'g' },
  { key: 'cholesterol_mg', label: 'Cholesterol', suffix: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', suffix: 'mg' },
  { key: 'calcium_mg', label: 'Calcium', suffix: 'mg' },
  { key: 'iron_mg', label: 'Iron', suffix: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', suffix: 'mcg' },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function TipRow({ tip }) {
  const palette = alertSeverityColors[tip.severity] || alertSeverityColors.info;
  return (
    <View style={[styles.tipRow, { backgroundColor: palette.bg, borderLeftColor: palette.fg }]}>
      <Text style={[typography.body, styles.tipTitle, { color: palette.fg }]}>{tip.title}</Text>
      <Text style={typography.bodySecondary}>{tip.detail}</Text>
    </View>
  );
}

export default function DietScreen({ navigation }) {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [refreshingTips, setRefreshingTips] = useState(false);
  const [showMicronutrients, setShowMicronutrients] = useState(false);

  const load = useCallback(async () => {
    try {
      const [summaryData, entriesData, recommendationData] = await Promise.all([
        fetchDietSummary(7),
        fetchDietEntries({ date: todayKey() }),
        fetchDietRecommendations(),
      ]);
      setSummary(summaryData);
      setEntries(entriesData.entries);
      setRecommendation(recommendationData.recommendation);
    } catch (err) {
      console.warn('Failed to load diet data', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  async function handleScanUpload(file) {
    if (!file) return;
    setScanning(true);
    try {
      const data = await uploadDietScan(file, new Date().toISOString());
      navigation.navigate('DietScanReview', { scanId: data.scan.id });
    } catch (err) {
      showAlert('Scan failed', err.message);
    } finally {
      setScanning(false);
    }
  }

  async function photograph() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Camera access is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync();
    if (result.canceled) return;
    const asset = result.assets[0];
    handleScanUpload({ uri: asset.uri, name: asset.fileName || 'meal.jpg', mimeType: asset.mimeType || 'image/jpeg', file: asset.file });
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Photo library access is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    handleScanUpload({ uri: asset.uri, name: asset.fileName || 'meal.jpg', mimeType: asset.mimeType || 'image/jpeg', file: asset.file });
  }

  async function openPendingReview() {
    try {
      const data = await fetchDietEntries({ unconfirmed: 'true' });
      const pending = data.entries[0];
      if (pending?.scan_id) navigation.navigate('DietScanReview', { scanId: pending.scan_id });
    } catch (err) {
      showAlert('Could not open pending review', err.message);
    }
  }

  async function handleRefreshTips() {
    setRefreshingTips(true);
    try {
      const data = await fetchDietRecommendations(true);
      setRecommendation(data.recommendation);
    } catch (err) {
      showAlert('Could not refresh recommendations', err.message);
    } finally {
      setRefreshingTips(false);
    }
  }

  function openEntry(entry) {
    if (!entry.is_confirmed && entry.source_type === 'photo_scan' && entry.scan_id) {
      navigation.navigate('DietScanReview', { scanId: entry.scan_id });
    } else {
      navigation.navigate('DietEntryForm', { entryId: entry.id });
    }
  }

  const today = summary?.today;
  const tips = recommendation?.tips || [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>Diet</Text>
        <Text style={[typography.bodySecondary, styles.subtitle]}>
          Scan a photo of your food or drink to log it automatically, or add it by hand.
        </Text>

        <View style={styles.scanSection}>
          <View style={styles.scanRow}>
            <PrimaryButton title="Take a photo" onPress={photograph} loading={scanning} />
            <PrimaryButton title="From library" variant="secondary" onPress={pickFromLibrary} loading={scanning} />
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('DietEntryForm')}>
            <Text style={styles.altAction}>Or add an item manually</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('DietRecipe')}>
            <Text style={styles.altAction}>Or generate a recipe idea with AI</Text>
          </TouchableOpacity>
        </View>

        {summary && summary.pendingReviewCount > 0 && (
          <TouchableOpacity style={styles.reviewBanner} onPress={openPendingReview}>
            <Text style={[typography.body, styles.reviewBannerText]}>
              {summary.pendingReviewCount} scanned item{summary.pendingReviewCount === 1 ? '' : 's'} need review
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>Today</Text>
          <TouchableOpacity onPress={() => navigation.navigate('DietStats')}>
            <Text style={styles.addLabel}>View stats →</Text>
          </TouchableOpacity>
        </View>
        {today && (
          <View style={[styles.totalsCard, cardShadow]}>
            <Text style={styles.caloriesValue}>{Math.round(today.calories)} <Text style={styles.caloriesUnit}>cal</Text></Text>
            <View style={styles.macroGrid}>
              {MACRO_LABELS.map((m) => (
                <View key={m.key} style={styles.macroItem}>
                  <Text style={typography.caption}>{m.label}</Text>
                  <Text style={typography.body}>
                    {Math.round(today[m.key] || 0)}{m.suffix}
                  </Text>
                </View>
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowMicronutrients((s) => !s)}>
              <Text style={styles.altAction}>{showMicronutrients ? 'Hide' : 'Show'} more nutrients ▾</Text>
            </TouchableOpacity>
            {showMicronutrients && (
              <View style={styles.macroGrid}>
                {MICRONUTRIENT_LABELS.map((m) => (
                  <View key={m.key} style={styles.macroItem}>
                    <Text style={typography.caption}>{m.label}</Text>
                    <Text style={typography.body}>
                      {Math.round(today[m.key] || 0)}{m.suffix}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>AI recommendations</Text>
          <TouchableOpacity onPress={handleRefreshTips} disabled={refreshingTips}>
            <Text style={styles.addLabel}>{refreshingTips ? 'Refreshing…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>
        {recommendation && (
          <Text style={[typography.bodySecondary, styles.recSummary]}>{recommendation.summary}</Text>
        )}
        {tips.length > 0 && (
          <View style={styles.tipsList}>
            {tips.map((tip) => (
              <TipRow key={tip.type} tip={tip} />
            ))}
          </View>
        )}

        <Text style={[typography.heading, styles.sectionHeading]}>Today's log</Text>
        {entries.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.empty]}>
            {loading ? 'Loading…' : 'Nothing logged yet today. Scan a photo or add an item above.'}
          </Text>
        ) : (
          entries.map((entry) => <FoodEntryCard key={entry.id} entry={entry} onPress={() => openEntry(entry)} />)
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
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  scanSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  scanRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  altAction: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  reviewBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.warningMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  reviewBannerText: {
    color: colors.warning,
    fontWeight: '600',
  },
  sectionHeading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  addLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  caloriesValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  caloriesUnit: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  macroItem: {
    minWidth: 70,
  },
  recSummary: {
    marginBottom: spacing.sm,
  },
  tipsList: {
    gap: spacing.sm,
  },
  tipRow: {
    borderRadius: radii.md,
    borderLeftWidth: 4,
    padding: spacing.md,
    gap: 2,
  },
  tipTitle: {
    fontWeight: '700',
  },
  empty: {
    marginTop: spacing.xs,
  },
});
