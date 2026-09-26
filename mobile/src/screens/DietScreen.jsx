import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import FoodEntryCard from '../components/FoodEntryCard';
import PrimaryButton from '../components/PrimaryButton';
import SpeakButton from '../components/SpeakButton';
import { alertSeverityColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import {
  fetchDietEntries,
  fetchDietRecommendations,
  fetchDietSummary,
  fetchSavedRecipes,
  logRecipeSuggestion,
  uploadDietScan,
} from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { openPrivacyIfConsentNeeded } from '../utils/consent';

const MACRO_LABELS = [
  { key: 'protein_g', labelKey: 'diet.macroProtein', suffix: 'g' },
  { key: 'carbs_g', labelKey: 'diet.macroCarbs', suffix: 'g' },
  { key: 'fat_g', labelKey: 'diet.macroFat', suffix: 'g' },
  { key: 'fiber_g', labelKey: 'diet.macroFiber', suffix: 'g' },
  { key: 'sugar_g', labelKey: 'diet.macroSugar', suffix: 'g' },
  { key: 'sodium_mg', labelKey: 'diet.macroSodium', suffix: 'mg' },
];

// The rest of the AI-estimated nutrients (dietPhotoProvider.js) - tucked
// behind a toggle so the default "Today" card stays a quick glance rather
// than a 12-value nutrition label.
const MICRONUTRIENT_LABELS = [
  { key: 'saturated_fat_g', labelKey: 'diet.microSatFat', suffix: 'g' },
  { key: 'cholesterol_mg', labelKey: 'diet.microCholesterol', suffix: 'mg' },
  { key: 'potassium_mg', labelKey: 'diet.microPotassium', suffix: 'mg' },
  { key: 'calcium_mg', labelKey: 'diet.microCalcium', suffix: 'mg' },
  { key: 'iron_mg', labelKey: 'diet.microIron', suffix: 'mg' },
  { key: 'vitamin_d_mcg', labelKey: 'diet.microVitaminD', suffix: 'mcg' },
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Builds the sentence SpeakButton reads for today's diet: totals, then the
// AI recommendation summary and each tip - the same content a sighted user
// reads off the "Today" card and "AI recommendations" section below.
function buildDietSpeech(today, macroLabels, recommendation, t) {
  const parts = [];
  if (today) {
    const macros = macroLabels.map((m) => `${t(m.labelKey)} ${Math.round(today[m.key] || 0)}${m.suffix}`).join(', ');
    parts.push(`${Math.round(today.calories)} cal. ${macros}.`);
  }
  if (recommendation?.summary) parts.push(recommendation.summary);
  for (const tip of recommendation?.tips || []) {
    parts.push(`${tip.title}. ${tip.detail}`);
  }
  return parts.join(' ');
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

// How many saved recipe ideas the quick-pick strip shows - just enough to
// glance at without turning the Diet screen into the Recipes screen. This
// is a free read (already-generated recipes, no AI call) - see
// fetchSavedRecipes.
const RECIPE_IDEAS_LIMIT = 6;

export default function DietScreen({ navigation }) {
  const t = useT();
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [recipeIdeas, setRecipeIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [refreshingTips, setRefreshingTips] = useState(false);
  const [showMicronutrients, setShowMicronutrients] = useState(false);
  const [addingRecipeId, setAddingRecipeId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [summaryData, entriesData, recommendationData, recipesData] = await Promise.all([
        fetchDietSummary(7),
        fetchDietEntries({ date: todayKey() }),
        fetchDietRecommendations(),
        fetchSavedRecipes({ limit: RECIPE_IDEAS_LIMIT }),
      ]);
      setSummary(summaryData);
      setEntries(entriesData.entries);
      setRecommendation(recommendationData.recommendation);
      setRecipeIdeas(recipesData.recipes);
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
      if (openPrivacyIfConsentNeeded(err, navigation)) return;
      showAlert(t('diet.scanFailed'), err.message);
    } finally {
      setScanning(false);
    }
  }

  async function photograph() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert(t('common.permissionNeeded'), t('common.cameraPermissionMessage'));
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
      showAlert(t('common.permissionNeeded'), t('common.libraryPermissionMessage'));
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
      showAlert(t('diet.couldNotOpenPendingReview'), err.message);
    }
  }

  async function handleRefreshTips() {
    setRefreshingTips(true);
    try {
      const data = await fetchDietRecommendations(true);
      setRecommendation(data.recommendation);
    } catch (err) {
      showAlert(t('diet.couldNotRefresh'), err.message);
    } finally {
      setRefreshingTips(false);
    }
  }

  // Logs a recipe idea straight from the Diet screen's quick-pick strip -
  // no AI call (the nutrition was estimated when the recipe was
  // generated) - then reloads today's totals/log so the addition shows up
  // immediately, the same as any other way of adding a food entry.
  async function handleAddRecipeIdea(recipe) {
    setAddingRecipeId(recipe.id);
    try {
      await logRecipeSuggestion(recipe.id);
      setRecipeIdeas((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, addedAt: new Date().toISOString() } : r)));
      await load();
    } catch (err) {
      showAlert('Could not add this recipe', err.message);
    } finally {
      setAddingRecipeId(null);
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
        <View style={styles.titleRow}>
          <Text style={typography.title}>{t('diet.title')}</Text>
          <SpeakButton
            text={buildDietSpeech(today, MACRO_LABELS, recommendation, t)}
            label={t('diet.readAloud')}
          />
        </View>
        <Text style={[typography.bodySecondary, styles.subtitle]}>{t('diet.subtitle')}</Text>

        <View style={styles.scanSection}>
          <View style={styles.scanRow}>
            <PrimaryButton title={t('diet.takePhoto')} onPress={photograph} loading={scanning} />
            <PrimaryButton title={t('diet.fromLibrary')} variant="secondary" onPress={pickFromLibrary} loading={scanning} />
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('DietEntryForm')}>
            <Text style={styles.altAction}>{t('diet.orAddManually')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>AI recipe ideas</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Recipes')}>
            <Text style={styles.addLabel}>{recipeIdeas.length > 0 ? 'See all →' : 'Generate ideas →'}</Text>
          </TouchableOpacity>
        </View>
        {recipeIdeas.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.empty]}>
            No AI recipe ideas yet - tap "Generate ideas" to get personalized suggestions.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipeIdeasRow}>
            {recipeIdeas.map((recipe) => (
              <View key={recipe.id} style={[styles.recipeIdeaCard, cardShadow]}>
                <Text style={typography.body} numberOfLines={2}>{recipe.title}</Text>
                {recipe.mealType && <Text style={styles.recipeIdeaMeal}>{recipe.mealType}</Text>}
                {recipe.nutritionPerServing.calories != null && (
                  <Text style={typography.caption}>{Math.round(recipe.nutritionPerServing.calories)} cal</Text>
                )}
                <PrimaryButton
                  title={recipe.addedAt ? 'Added ✓' : 'Add'}
                  variant="secondary"
                  onPress={() => handleAddRecipeIdea(recipe)}
                  loading={addingRecipeId === recipe.id}
                  disabled={addingRecipeId === recipe.id}
                />
              </View>
            ))}
          </ScrollView>
        )}

        {summary && summary.pendingReviewCount > 0 && (
          <TouchableOpacity style={styles.reviewBanner} onPress={openPendingReview}>
            <Text style={[typography.body, styles.reviewBannerText]}>
              {t('diet.itemsNeedReview', { count: summary.pendingReviewCount, plural: summary.pendingReviewCount === 1 ? '' : 's' })}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={typography.heading}>{t('diet.today')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('DietStats')}>
            <Text style={styles.addLabel}>{t('diet.viewStats')}</Text>
          </TouchableOpacity>
        </View>
        {today && (
          <View style={[styles.totalsCard, cardShadow]}>
            <Text style={styles.caloriesValue}>
              {Math.round(today.calories)} <Text style={styles.caloriesUnit}>{t('diet.calSuffix').trim()}</Text>
            </Text>
            <View style={styles.macroGrid}>
              {MACRO_LABELS.map((m) => (
                <View key={m.key} style={styles.macroItem}>
                  <Text style={typography.caption}>{t(m.labelKey)}</Text>
                  <Text style={typography.body}>
                    {Math.round(today[m.key] || 0)}{m.suffix}
                  </Text>
                </View>
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowMicronutrients((s) => !s)}>
              <Text style={styles.altAction}>{t(showMicronutrients ? 'diet.hideMore' : 'diet.showMore')}</Text>
            </TouchableOpacity>
            {showMicronutrients && (
              <View style={styles.macroGrid}>
                {MICRONUTRIENT_LABELS.map((m) => (
                  <View key={m.key} style={styles.macroItem}>
                    <Text style={typography.caption}>{t(m.labelKey)}</Text>
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
          <Text style={typography.heading}>{t('diet.aiRecommendations')}</Text>
          <TouchableOpacity onPress={handleRefreshTips} disabled={refreshingTips}>
            <Text style={styles.addLabel}>{t(refreshingTips ? 'diet.refreshing' : 'diet.refresh')}</Text>
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

        <Text style={[typography.heading, styles.sectionHeading]}>{t('diet.todaysLog')}</Text>
        {entries.length === 0 ? (
          <Text style={[typography.bodySecondary, styles.empty]}>
            {loading ? t('diet.loadingLog') : t('diet.empty')}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  recipeIdeasRow: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  recipeIdeaCard: {
    width: 150,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.sm,
    gap: 4,
  },
  recipeIdeaMeal: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
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
