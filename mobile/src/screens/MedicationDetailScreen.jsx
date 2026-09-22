import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import MedicationForm from '../components/MedicationForm';
import PrimaryButton from '../components/PrimaryButton';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { deleteMedication, fetchMedication, updateMedication } from '../api/client';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'discontinued', label: 'Discontinued' },
];

const STANDARD_STATUS_LABEL = {
  in_range: 'Within standard range',
  below_range: 'Below standard range',
  above_range: 'Above standard range',
  unknown: 'No lab result yet',
};

const FORECAST_LABEL_STYLE = {
  too_early: healthStatusColors.no_data,
  improvement_expected_now: healthStatusColors.watch,
  reassess_with_labs: healthStatusColors.attention,
  unknown: healthStatusColors.no_data,
};

function scoreToStatus(percent) {
  if (percent === null) return 'no_data';
  if (percent >= 80) return 'good';
  if (percent >= 50) return 'watch';
  return 'attention';
}

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function BulletList({ items, textStyle }) {
  return (
    <View style={styles.bulletList}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={[typography.bodySecondary, textStyle]}>{'•'}</Text>
          <Text style={[typography.bodySecondary, styles.bulletText, textStyle]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function ScoreBar({ percent, palette }) {
  const width = percent === null ? 0 : Math.max(4, Math.min(100, percent));
  return (
    <View style={[styles.barTrack, { backgroundColor: palette.track }]}>
      <View style={[styles.barFill, { width: `${width}%`, backgroundColor: palette.fg }]} />
    </View>
  );
}

function ParameterForecastRow({ item }) {
  const rangePalette = healthStatusColors[item.inStandardRange === false ? 'attention' : item.inStandardRange ? 'good' : 'no_data'];
  const forecastPalette = FORECAST_LABEL_STYLE[item.forecastStage] || healthStatusColors.no_data;

  return (
    <View style={styles.paramRow}>
      <View style={styles.paramHeaderRow}>
        <Text style={typography.body} numberOfLines={1}>
          {item.parameterDisplayName}
        </Text>
        <View style={[styles.pill, { backgroundColor: rangePalette.bg }]}>
          <Text style={[styles.pillText, { color: rangePalette.fg }]}>{STANDARD_STATUS_LABEL[item.standardStatus]}</Text>
        </View>
      </View>

      {item.latestMeasurement ? (
        <Text style={typography.caption}>
          Latest: {item.latestMeasurement.value} {item.latestMeasurement.unit || ''} on{' '}
          {formatDate(item.latestMeasurement.effectiveDate)}
        </Text>
      ) : (
        <Text style={typography.caption}>No confirmed lab result for this parameter yet</Text>
      )}

      {item.standardRange && (
        <Text style={typography.caption}>
          Standard range ({item.standardRange.source.toUpperCase()}): {item.standardRange.low}–{item.standardRange.high}{' '}
          {item.standardRange.unit}
        </Text>
      )}

      <View style={[styles.pill, styles.forecastPill, { backgroundColor: forecastPalette.bg }]}>
        <Text style={[styles.pillText, { color: forecastPalette.fg }]}>{item.forecastLabel}</Text>
      </View>
      {item.rationale && <Text style={styles.rationale}>{item.rationale}</Text>}
    </View>
  );
}

export default function MedicationDetailScreen({ route, navigation }) {
  const { medicationId } = route.params;
  const [medication, setMedication] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMedication(medicationId);
      setMedication(data.medication);
      setKnowledge(data.knowledge);
      setForecast(data.forecast);
      setDraft(data.medication);
    } catch (err) {
      console.warn('Failed to load medication', err.message);
    }
  }, [medicationId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation, load]);

  useEffect(() => {
    if (medication) navigation.setOptions({ title: medication.name });
  }, [navigation, medication]);

  async function handleSave() {
    setBusy(true);
    try {
      await updateMedication(medicationId, {
        name: draft.name,
        generic_name: draft.generic_name,
        form: draft.form,
        dosage_amount: draft.dosage_amount === '' ? null : draft.dosage_amount,
        dosage_unit: draft.dosage_unit,
        frequency_per_day: draft.frequency_per_day === '' ? null : draft.frequency_per_day,
        instructions: draft.instructions,
        prescribed_for: draft.prescribed_for,
        prescribing_doctor: draft.prescribing_doctor,
        start_date: draft.start_date || null,
        duration_days: draft.duration_days === '' ? null : draft.duration_days,
        quantity_dispensed: draft.quantity_dispensed === '' ? null : draft.quantity_dispensed,
        expiry_date: draft.expiry_date || null,
        ingredients_raw: draft.ingredients_raw || null,
      });
      setEditing(false);
      await load();
    } catch (err) {
      Alert.alert('Could not save changes', err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(status) {
    if (!status) return;
    try {
      await updateMedication(medicationId, { status });
      await load();
    } catch (err) {
      Alert.alert('Could not update status', err.message);
    }
  }

  function handleDelete() {
    Alert.alert('Delete medication?', `This removes ${medication.name} and its tracking history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedication(medicationId);
            navigation.goBack();
          } catch (err) {
            Alert.alert('Could not delete medication', err.message);
          }
        },
      },
    ]);
  }

  if (!medication || !forecast) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const scorePalette = healthStatusColors[scoreToStatus(forecast.standardsScorePercent)];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!editing ? (
          <>
            <View style={[styles.heroCard, cardShadow]}>
              <View style={styles.heroTopRow}>
                <Text style={typography.title}>{medication.name}</Text>
                <Text style={[styles.heroScore, { color: scorePalette.fg }]}>
                  {forecast.standardsScorePercent === null ? '—' : `${forecast.standardsScorePercent}%`}
                </Text>
              </View>
              <ScoreBar percent={forecast.standardsScorePercent} palette={scorePalette} />
              <Text style={styles.disclaimer}>
                Score = share of this medication's linked lab results currently within a general WHO / ICMR / FDA-aligned
                clinical reference range - not the range printed on any one lab report. General reference only, not a
                diagnosis - always follow your doctor's guidance.
              </Text>
            </View>

            {(medication.ingredients_raw || knowledge?.activeIngredient) && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>Ingredients</Text>
                {medication.ingredients_raw && (
                  <Text style={typography.body}>{medication.ingredients_raw}</Text>
                )}
                {knowledge?.activeIngredient && (
                  <Text style={typography.bodySecondary}>
                    {medication.ingredients_raw ? 'Active ingredient: ' : ''}
                    {knowledge.activeIngredient}
                  </Text>
                )}
                {!medication.ingredients_raw && (
                  <Text style={styles.disclaimer}>
                    Not read from a scanned label - this is the drug's general active ingredient, not necessarily this
                    exact product's full composition.
                  </Text>
                )}
              </View>
            )}

            {knowledge && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>{knowledge.category}</Text>
                <Text style={typography.bodySecondary}>{knowledge.usage}</Text>
              </View>
            )}

            {knowledge?.commonSideEffects?.length > 0 && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>Common side effects</Text>
                <BulletList items={knowledge.commonSideEffects} />
              </View>
            )}

            {knowledge?.warnings?.length > 0 && (
              <View style={[styles.section, styles.warningBox]}>
                <Text style={[typography.heading, styles.sectionHeading, styles.warningHeading]}>
                  Alerts &amp; safety warnings
                </Text>
                <BulletList items={knowledge.warnings} textStyle={styles.warningText} />
              </View>
            )}

            {(knowledge?.commonSideEffects?.length > 0 || knowledge?.warnings?.length > 0) && (
              <Text style={styles.disclaimer}>
                General drug reference information, not personalized medical advice - always check the product label and
                your doctor or pharmacist.
              </Text>
            )}

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>Dosage schedule</Text>
              <Text style={typography.body}>
                {[medication.dosage_amount && `${medication.dosage_amount}${medication.dosage_unit || ''}`, medication.form]
                  .filter(Boolean)
                  .join(' · ') || 'Not recorded'}
              </Text>
              {medication.frequency_per_day && (
                <Text style={typography.bodySecondary}>{medication.frequency_per_day}x per day</Text>
              )}
              {medication.instructions && <Text style={typography.bodySecondary}>{medication.instructions}</Text>}
              {forecast.doseAssessment && (
                <View style={[styles.pill, styles.doseNote, { backgroundColor: colors.surfaceMuted }]}>
                  <Text style={[styles.pillText, { color: colors.textSecondary }]}>
                    Daily dose {forecast.doseAssessment.dailyDose}
                    {forecast.doseAssessment.unit} is{' '}
                    {forecast.doseAssessment.level === 'within_typical'
                      ? 'within the typical range'
                      : forecast.doseAssessment.level === 'below_typical'
                        ? 'below the typical range'
                        : 'above the typical range'}{' '}
                    ({forecast.doseAssessment.typicalMin}-{forecast.doseAssessment.typicalMax}
                    {forecast.doseAssessment.unit}/day)
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>Course &amp; supply</Text>
              {medication.prescribed_for && <Text style={typography.bodySecondary}>For: {medication.prescribed_for}</Text>}
              {medication.prescribing_doctor && (
                <Text style={typography.bodySecondary}>Prescribed by: {medication.prescribing_doctor}</Text>
              )}
              {medication.start_date && (
                <Text style={typography.bodySecondary}>
                  Started {formatDate(medication.start_date)}
                  {medication.end_date ? ` · course ends ${formatDate(medication.end_date)}` : ''}
                </Text>
              )}
              {medication.expiry_date && (
                <Text style={typography.bodySecondary}>Expires {formatDate(medication.expiry_date)}</Text>
              )}
              {forecast.elapsedDays !== null && (
                <Text style={typography.caption}>{forecast.elapsedDays} days since starting</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>Linked lab parameters</Text>
              {forecast.parameterForecasts.length === 0 ? (
                <Text style={typography.bodySecondary}>
                  This medication isn't linked to any tracked lab parameter yet.
                </Text>
              ) : (
                forecast.parameterForecasts.map((item) => <ParameterForecastRow key={item.healthParameterId} item={item} />)
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>Status</Text>
              <ChipSelect options={STATUS_OPTIONS} value={medication.status} onChange={handleStatusChange} allowClear={false} />
            </View>

            <View style={styles.actionsRow}>
              <PrimaryButton title="Edit" variant="secondary" onPress={() => setEditing(true)} />
              <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
                <Text style={styles.deleteLabel}>Delete</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <MedicationForm value={draft} onChange={setDraft} />
            <View style={styles.actionsRow}>
              <PrimaryButton title="Save" onPress={handleSave} loading={busy} />
              <PrimaryButton title="Cancel" variant="secondary" onPress={() => { setDraft(medication); setEditing(false); }} />
            </View>
          </View>
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
    gap: spacing.lg,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroScore: {
    fontSize: 28,
    fontWeight: '800',
  },
  barTrack: {
    height: 8,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeading: {
    marginBottom: 2,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  doseNote: {
    marginTop: 4,
  },
  bulletList: {
    gap: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  bulletText: {
    flex: 1,
  },
  warningBox: {
    backgroundColor: colors.warningMuted,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  warningHeading: {
    color: colors.warning,
  },
  warningText: {
    color: colors.warning,
  },
  paramRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 4,
  },
  paramHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  forecastPill: {
    marginTop: 4,
  },
  rationale: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  deleteButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  deleteLabel: {
    color: colors.danger,
    fontWeight: '600',
  },
});
