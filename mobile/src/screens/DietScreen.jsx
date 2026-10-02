import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import FoodEntryCard from '../components/FoodEntryCard';
import PrimaryButton from '../components/PrimaryButton';
import GradientFill from '../components/brand/GradientFill';
import ActivityRings from '../components/ActivityRings';
import SpeakButton from '../components/SpeakButton';
import { alertSeverityColors, brandShadow, card3D, cardShadow, colors, gradients, radii, spacing, typography } from '../theme/theme';
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

// Reference daily targets for the progress rings/bars - a general-purpose
// guide (2000 kcal diet), not a personalised prescription.
const DAILY_TARGETS = { calories: 2000, protein_g: 75, carbs_g: 250, fat_g: 65 };

const MACRO_TILES = [
  { key: 'protein_g', labelKey: 'diet.macroProtein', icon: '💪', color: '#0E9FB4', soft: '#E1F7FA', target: DAILY_TARGETS.protein_g },
  { key: 'carbs_g', labelKey: 'diet.macroCarbs', icon: '🌾', color: '#6C4DFF', soft: '#EFEBFF', target: DAILY_TARGETS.carbs_g },
  { key: 'fat_g', labelKey: 'diet.macroFat', icon: '🥑', color: '#0FB981', soft: '#E2F9F0', target: DAILY_TARGETS.fat_g },
  { key: 'fiber_g', labelKey: 'diet.macroFiber', icon: '🥦', color: '#FF9500', soft: '#FFF3E0', target: 28 },
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
    <View style={[styles.tipRow, card3D(palette.fg)]}>
      <View style={[styles.tipIcon, { backgroundColor: palette.bg }]}>
        <Text style={styles.tipIconText}>{tip.severity === 'important' ? '⚠️' : tip.severity === 'attention' ? '💡' : '✨'}</Text>
      </View>
      <View style={styles.tipBody}>
        <Text style={[typography.body, styles.tipTitle, { color: palette.fg }]}>{tip.title}</Text>
        <Text style={typography.bodySecondary}>{tip.detail}</Text>
      </View>
    </View>
  );
}

// How many saved recipe ideas the quick-pick strip shows - just enough to
// glance at without turning the Diet screen into the Recipes screen. This
// is a free read (already-generated recipes, no AI call) - see
// fetchSavedRecipes.
const RECIPE_IDEAS_LIMIT = 6;

const RECIPE_GRADIENTS = [
  ['#FF8A4C', '#FF4F9A'],
  ['#1FD1C1', '#4F7BFF'],
  ['#34D399', '#0FB981'],
  ['#6C4DFF', '#A94BFF'],
];

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

        {/* Hero: calorie ring + the day's headline numbers */}
        <View style={[styles.hero, brandShadow]}>
          <GradientFill />
          <View style={styles.heroBlob} />
          <View style={styles.heroTop}>
            <View style={styles.heroRing}>
              <ActivityRings
                size={132}
                strokeWidth={11}
                gap={3}
                rings={[
                  { percent: (today?.calories || 0) / DAILY_TARGETS.calories, fg: '#FFFFFF', track: 'rgba(255,255,255,0.25)' },
                  { percent: (today?.protein_g || 0) / DAILY_TARGETS.protein_g, fg: '#7DF9E0', track: 'rgba(255,255,255,0.18)' },
                ]}
              />
              <View style={styles.heroRingCenter} pointerEvents="none">
                <Text style={styles.heroRingValue}>{Math.round(today?.calories || 0)}</Text>
                <Text style={styles.heroRingUnit}>{t('diet.calSuffix').trim()}</Text>
              </View>
            </View>
            <View style={styles.heroStats}>
              <Text style={styles.heroLabel}>{t('diet.today')}</Text>
              <Text style={styles.heroLeft}>
                {Math.max(0, DAILY_TARGETS.calories - Math.round(today?.calories || 0))}
                <Text style={styles.heroLeftUnit}> / {DAILY_TARGETS.calories} left</Text>
              </Text>
              <View style={styles.heroChips}>
                {MACRO_TILES.slice(0, 3).map((m) => (
                  <View key={m.key} style={styles.heroChip}>
                    <Text style={styles.heroChipText}>
                      {m.icon} {Math.round(today?.[m.key] || 0)}g
                    </Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => navigation.navigate('DietStats')}>
                <Text style={styles.heroLink}>{t('diet.viewStats')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Scan: the primary action, big and tactile */}
        <TouchableOpacity style={[styles.scanCta, card3D('#FF4F9A')]} onPress={photograph} disabled={scanning} activeOpacity={0.85}>
          <GradientFill colors={gradients.sunrise} angle="horizontal" />
          <View style={styles.scanIcon}>
            <Text style={styles.scanIconText}>{scanning ? '⏳' : '📸'}</Text>
          </View>
          <View style={styles.scanCopy}>
            <Text style={styles.scanTitle}>{t('diet.takePhoto')}</Text>
            <Text style={styles.scanSub}>{t('diet.subtitle')}</Text>
          </View>
          <Text style={styles.scanArrow}>›</Text>
        </TouchableOpacity>
        <View style={styles.scanRow}>
          <TouchableOpacity style={[styles.quickAction, cardShadow]} onPress={pickFromLibrary} disabled={scanning}>
            <Text style={styles.quickIcon}>🖼️</Text>
            <Text style={styles.quickText}>{t('diet.fromLibrary')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickAction, cardShadow]} onPress={() => navigation.navigate('DietEntryForm')}>
            <Text style={styles.quickIcon}>✍️</Text>
            <Text style={styles.quickText}>{t('diet.orAddManually')}</Text>
          </TouchableOpacity>
        </View>

        {summary && summary.pendingReviewCount > 0 && (
          <TouchableOpacity style={[styles.reviewBanner, card3D(colors.warning)]} onPress={openPendingReview}>
            <Text style={styles.reviewIcon}>🔔</Text>
            <Text style={[typography.body, styles.reviewBannerText]}>
              {t('diet.itemsNeedReview', { count: summary.pendingReviewCount, plural: summary.pendingReviewCount === 1 ? '' : 's' })}
            </Text>
          </TouchableOpacity>
        )}

        {/* Macro tiles: 2x2 raised tiles with progress */}
        {today && (
          <>
            <View style={styles.tileGrid}>
              {MACRO_TILES.map((m) => {
                const value = today[m.key] || 0;
                const pct = Math.min(1, value / m.target);
                return (
                  <View key={m.key} style={[styles.tile, card3D(m.color)]}>
                    <View style={styles.tileTop}>
                      <View style={[styles.tileIcon, { backgroundColor: m.soft }]}>
                        <Text style={styles.tileIconText}>{m.icon}</Text>
                      </View>
                      <Text style={styles.tileLabel}>{t(m.labelKey)}</Text>
                    </View>
                    <Text style={styles.tileValue}>
                      {Math.round(value)}
                      <Text style={styles.tileUnit}>g</Text>
                    </Text>
                    <View style={[styles.tileTrack, { backgroundColor: m.soft }]}>
                      <View style={[styles.tileFill, { width: `${Math.max(pct * 100, value > 0 ? 6 : 0)}%`, backgroundColor: m.color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity style={styles.moreToggle} onPress={() => setShowMicronutrients((s) => !s)}>
              <Text style={styles.altAction}>{t(showMicronutrients ? 'diet.hideMore' : 'diet.showMore')}</Text>
            </TouchableOpacity>
            {showMicronutrients && (
              <View style={[styles.microCard, cardShadow]}>
                {[...MACRO_LABELS.slice(4), ...MICRONUTRIENT_LABELS].map((m) => (
                  <View key={m.key} style={styles.microItem}>
                    <Text style={typography.caption}>{t(m.labelKey)}</Text>
                    <Text style={styles.microValue}>
                      {Math.round(today[m.key] || 0)}{m.suffix}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

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
            {recipeIdeas.map((recipe, index) => {
              const palette = RECIPE_GRADIENTS[index % RECIPE_GRADIENTS.length];
              return (
                <View key={recipe.id} style={[styles.recipeIdeaCard, card3D(palette[1])]}>
                  <View style={styles.recipeBanner}>
                    <GradientFill colors={palette} />
                    <Text style={styles.recipeEmoji}>🍽️</Text>
                    {recipe.nutritionPerServing.calories != null && (
                      <View style={styles.recipeCal}>
                        <Text style={styles.recipeCalText}>{Math.round(recipe.nutritionPerServing.calories)} cal</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.recipeBody}>
                    <Text style={[typography.body, styles.recipeTitle]} numberOfLines={2}>{recipe.title}</Text>
                    {recipe.mealType && <Text style={[styles.recipeIdeaMeal, { color: palette[1] }]}>{recipe.mealType}</Text>}
                    <PrimaryButton
                      title={recipe.addedAt ? 'Added ✓' : '+ Add'}
                      variant="secondary"
                      onPress={() => handleAddRecipeIdea(recipe)}
                      loading={addingRecipeId === recipe.id}
                      disabled={addingRecipeId === recipe.id}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        <TouchableOpacity style={[styles.schedulesRow, card3D(colors.teal)]} onPress={() => navigation.navigate('DietSchedules')} activeOpacity={0.85}>
          <View style={[styles.tileIcon, { backgroundColor: colors.tealMuted }]}>
            <Text style={styles.tileIconText}>🗓️</Text>
          </View>
          <Text style={[typography.heading, styles.schedulesText]}>Diet schedules</Text>
          <Text style={styles.addLabel}>See all →</Text>
        </TouchableOpacity>

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
    marginBottom: spacing.md,
  },
  altAction: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  // Hero
  hero: {
    borderRadius: radii.xl,
    padding: spacing.md,
    overflow: 'hidden',
  },
  heroBlob: {
    position: 'absolute',
    right: -50,
    top: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroRing: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  heroRingValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onBrand,
  },
  heroRingUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onBrandMuted,
  },
  heroStats: {
    flex: 1,
    gap: 6,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.onBrandMuted,
  },
  heroLeft: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.onBrand,
  },
  heroLeftUnit: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onBrandMuted,
  },
  heroChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroChipText: {
    color: colors.onBrand,
    fontSize: 12,
    fontWeight: '700',
  },
  heroLink: {
    color: colors.onBrand,
    fontWeight: '700',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  // Scan CTA
  scanCta: {
    marginTop: spacing.md,
    borderRadius: radii.xl,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  scanIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIconText: { fontSize: 26 },
  scanCopy: { flex: 1 },
  scanTitle: { color: colors.onBrand, fontSize: 18, fontWeight: '800' },
  scanSub: { color: colors.onBrandMuted, fontSize: 12, marginTop: 2 },
  scanArrow: { color: colors.onBrand, fontSize: 32, fontWeight: '300' },
  scanRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  quickAction: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickIcon: { fontSize: 18 },
  quickText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  // Macro tiles
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  tile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconText: { fontSize: 17 },
  tileLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  tileValue: { fontSize: 30, fontWeight: '800', color: colors.textPrimary },
  tileUnit: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tileTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tileFill: {
    height: 8,
    borderRadius: 4,
  },
  moreToggle: {
    marginTop: spacing.md,
  },
  microCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  microItem: { minWidth: 80 },
  microValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  // Recipes
  recipeIdeasRow: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: 2,
  },
  recipeIdeaCard: {
    width: 170,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  recipeBanner: {
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeEmoji: { fontSize: 34 },
  recipeCal: {
    position: 'absolute',
    right: 8,
    top: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recipeCalText: { fontSize: 11, fontWeight: '800', color: colors.textPrimary },
  recipeBody: {
    padding: spacing.sm + 2,
    gap: 4,
  },
  recipeTitle: { fontWeight: '700', minHeight: 40 },
  recipeIdeaMeal: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  schedulesRow: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  schedulesText: { flex: 1 },
  reviewBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.warningMuted,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reviewIcon: { fontSize: 20 },
  reviewBannerText: {
    flex: 1,
    color: colors.warning,
    fontWeight: '700',
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
  recSummary: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  tipsList: {
    gap: spacing.sm + 2,
  },
  tipRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipIconText: { fontSize: 17 },
  tipBody: { flex: 1, gap: 2 },
  tipTitle: {
    fontWeight: '700',
  },
  empty: {
    marginTop: spacing.xs,
  },
});
