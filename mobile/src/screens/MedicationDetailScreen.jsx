import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChipSelect from '../components/ChipSelect';
import MedicationForm from '../components/MedicationForm';
import PrimaryButton from '../components/PrimaryButton';
import SpeakButton from '../components/SpeakButton';
import { cardShadow, colors, healthStatusColors, radii, spacing, typography } from '../theme/theme';
import { deleteMedication, fetchMedication, updateMedication } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { formatCalendarDate } from '../utils/date';

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
  return formatCalendarDate(value, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Builds the sentence SpeakButton reads for the whole medication: dosage,
// what it's for, common side effects and warnings, and how each linked lab
// result is expected to respond - the same information a sighted user reads
// off this screen's sections below, said aloud instead.
function buildMedicationSpeech(medication, knowledge, forecast, t) {
  const parts = [medication.name];
  const dose = [medication.dosage_amount && `${medication.dosage_amount}${medication.dosage_unit || ''}`, medication.form]
    .filter(Boolean)
    .join(' ');
  if (dose) parts.push(dose);
  if (medication.frequency_per_day) parts.push(t('medicationDetail.timesPerDay', { count: medication.frequency_per_day }));
  if (medication.instructions) parts.push(medication.instructions);
  if (knowledge?.usage) parts.push(knowledge.usage);
  if (knowledge?.commonSideEffects?.length) parts.push(`${t('medicationDetail.sideEffects')}: ${knowledge.commonSideEffects.join(', ')}.`);
  if (knowledge?.warnings?.length) parts.push(`${t('medicationDetail.warnings')}: ${knowledge.warnings.join(', ')}.`);
  return parts.join('. ');
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

const STANDARD_STATUS_KEYS = {
  in_range: 'medicationDetail.standardInRange',
  below_range: 'medicationDetail.standardBelowRange',
  above_range: 'medicationDetail.standardAboveRange',
  unknown: 'medicationDetail.standardUnknown',
};

// item.forecastLabel (from the server's medicationForecastService.js) is a
// fixed English string, not AI-generated text the language preference
// already threads through - item.forecastStage is the same forecast as a
// stable enum, so it's translated here from that instead of shown as-is.
const FORECAST_LABEL_KEYS = {
  too_early: 'medicationDetail.forecastTooEarly',
  improvement_expected_now: 'medicationDetail.forecastImprovementExpected',
  reassess_with_labs: 'medicationDetail.forecastReassess',
  unknown: 'medicationDetail.forecastUnknown',
};

function ParameterForecastRow({ item, t }) {
  const rangePalette = healthStatusColors[item.inStandardRange === false ? 'attention' : item.inStandardRange ? 'good' : 'no_data'];
  const forecastPalette = FORECAST_LABEL_STYLE[item.forecastStage] || healthStatusColors.no_data;

  return (
    <View style={styles.paramRow}>
      <View style={styles.paramHeaderRow}>
        <Text style={typography.body} numberOfLines={1}>
          {item.parameterDisplayName}
        </Text>
        <View style={[styles.pill, { backgroundColor: rangePalette.bg }]}>
          <Text style={[styles.pillText, { color: rangePalette.fg }]}>{t(STANDARD_STATUS_KEYS[item.standardStatus])}</Text>
        </View>
      </View>

      {item.latestMeasurement ? (
        <Text style={typography.caption}>
          {t('medicationDetail.latestValue', {
            value: item.latestMeasurement.value,
            unit: item.latestMeasurement.unit || '',
            date: formatDate(item.latestMeasurement.effectiveDate),
          })}
        </Text>
      ) : (
        <Text style={typography.caption}>{t('medicationDetail.noResultYet')}</Text>
      )}

      {item.standardRange && (
        <Text style={typography.caption}>
          {t('medicationDetail.standardRange', {
            source: item.standardRange.source.toUpperCase(),
            low: item.standardRange.low,
            high: item.standardRange.high,
            unit: item.standardRange.unit,
          })}
        </Text>
      )}

      <View style={[styles.pill, styles.forecastPill, { backgroundColor: forecastPalette.bg }]}>
        <Text style={[styles.pillText, { color: forecastPalette.fg }]}>
          {t(FORECAST_LABEL_KEYS[item.forecastStage] || FORECAST_LABEL_KEYS.unknown)}
        </Text>
      </View>
      {item.rationale && <Text style={styles.rationale}>{item.rationale}</Text>}
    </View>
  );
}

export default function MedicationDetailScreen({ route, navigation }) {
  const { medicationId } = route.params;
  const t = useT();
  const STATUS_OPTIONS = [
    { value: 'active', label: t('medicationDetail.statusActive') },
    { value: 'completed', label: t('medicationDetail.statusCompleted') },
    { value: 'discontinued', label: t('medicationDetail.statusDiscontinued') },
  ];
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
      showAlert(t('medicationDetail.couldNotSave'), err.message);
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
      showAlert(t('medicationDetail.couldNotUpdateStatus'), err.message);
    }
  }

  function handleDelete() {
    showAlert(
      t('medicationDetail.deleteConfirmTitle'),
      t('medicationDetail.deleteConfirmMessage', { name: medication.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMedication(medicationId);
              // goBack() silently does nothing when this screen has no prior
              // in-app history to return to (a deep link, a bookmark, or a
              // browser refresh while already on this screen all land here
              // with an empty stack) - the delete still succeeds on the
              // server, but the screen would be left showing the now-deleted
              // medication with no visible sign anything happened, looking
              // exactly like the button did nothing. Always land somewhere
              // real instead.
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Tabs', { screen: 'MedicationsTab' });
              }
            } catch (err) {
              showAlert(t('medicationDetail.couldNotDelete'), err.message);
            }
          },
        },
      ]
    );
  }

  if (!medication || !forecast) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('medicationDetail.loading')}</Text>
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
                <SpeakButton
                  text={buildMedicationSpeech(medication, knowledge, forecast, t)}
                  label={t('medicationDetail.readAloud')}
                />
                <Text style={[styles.heroScore, { color: scorePalette.fg }]}>
                  {forecast.standardsScorePercent === null ? '—' : `${forecast.standardsScorePercent}%`}
                </Text>
              </View>
              <ScoreBar percent={forecast.standardsScorePercent} palette={scorePalette} />
              <Text style={styles.disclaimer}>{t('medicationDetail.scoreDisclaimer')}</Text>
            </View>

            {(medication.ingredients_raw || knowledge?.activeIngredient) && (
              <View style={styles.section}>
                <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.ingredients')}</Text>
                {medication.ingredients_raw && (
                  <Text style={typography.body}>{medication.ingredients_raw}</Text>
                )}
                {knowledge?.activeIngredient && (
                  <Text style={typography.bodySecondary}>
                    {medication.ingredients_raw ? t('medicationDetail.activeIngredientPrefix') : ''}
                    {knowledge.activeIngredient}
                  </Text>
                )}
                {!medication.ingredients_raw && (
                  <Text style={styles.disclaimer}>{t('medicationDetail.notFromLabel')}</Text>
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
                <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.sideEffects')}</Text>
                <BulletList items={knowledge.commonSideEffects} />
              </View>
            )}

            {knowledge?.warnings?.length > 0 && (
              <View style={[styles.section, styles.warningBox]}>
                <Text style={[typography.heading, styles.sectionHeading, styles.warningHeading]}>
                  {t('medicationDetail.warnings')}
                </Text>
                <BulletList items={knowledge.warnings} textStyle={styles.warningText} />
              </View>
            )}

            {(knowledge?.commonSideEffects?.length > 0 || knowledge?.warnings?.length > 0) && (
              <Text style={styles.disclaimer}>{t('medicationDetail.drugDisclaimer')}</Text>
            )}

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.dosageSchedule')}</Text>
              <Text style={typography.body}>
                {[medication.dosage_amount && `${medication.dosage_amount}${medication.dosage_unit || ''}`, medication.form]
                  .filter(Boolean)
                  .join(' · ') || t('medicationDetail.notRecorded')}
              </Text>
              {medication.frequency_per_day && (
                <Text style={typography.bodySecondary}>
                  {t('medicationDetail.timesPerDay', { count: medication.frequency_per_day })}
                </Text>
              )}
              {medication.instructions && <Text style={typography.bodySecondary}>{medication.instructions}</Text>}
              {forecast.doseAssessment && (
                <View style={[styles.pill, styles.doseNote, { backgroundColor: colors.surfaceMuted }]}>
                  <Text style={[styles.pillText, { color: colors.textSecondary }]}>
                    {t('medicationDetail.dailyDoseNote', {
                      dose: forecast.doseAssessment.dailyDose,
                      unit: forecast.doseAssessment.unit,
                      level: t(
                        forecast.doseAssessment.level === 'within_typical'
                          ? 'medicationDetail.doseWithin'
                          : forecast.doseAssessment.level === 'below_typical'
                            ? 'medicationDetail.doseBelow'
                            : 'medicationDetail.doseAbove'
                      ),
                      min: forecast.doseAssessment.typicalMin,
                      max: forecast.doseAssessment.typicalMax,
                    })}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.courseSupply')}</Text>
              {medication.prescribed_for && (
                <Text style={typography.bodySecondary}>
                  {t('medicationDetail.forLabel', { value: medication.prescribed_for })}
                </Text>
              )}
              {medication.prescribing_doctor && (
                <Text style={typography.bodySecondary}>
                  {t('medicationDetail.prescribedBy', { value: medication.prescribing_doctor })}
                </Text>
              )}
              {medication.start_date && (
                <Text style={typography.bodySecondary}>
                  {t('medicationDetail.started', { date: formatDate(medication.start_date) })}
                  {medication.end_date ? t('medicationDetail.courseEnds', { date: formatDate(medication.end_date) }) : ''}
                </Text>
              )}
              {medication.expiry_date && (
                <Text style={typography.bodySecondary}>
                  {t('medicationDetail.expires', { date: formatDate(medication.expiry_date) })}
                </Text>
              )}
              {forecast.elapsedDays !== null && (
                <Text style={typography.caption}>
                  {t('medicationDetail.daysSinceStarting', { count: forecast.elapsedDays })}
                </Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.linkedParameters')}</Text>
              {forecast.parameterForecasts.length === 0 ? (
                <Text style={typography.bodySecondary}>{t('medicationDetail.noLinkedParameters')}</Text>
              ) : (
                forecast.parameterForecasts.map((item) => (
                  <ParameterForecastRow key={item.healthParameterId} item={item} t={t} />
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={[typography.heading, styles.sectionHeading]}>{t('medicationDetail.status')}</Text>
              <ChipSelect options={STATUS_OPTIONS} value={medication.status} onChange={handleStatusChange} allowClear={false} />
            </View>

            <View style={styles.actionsRow}>
              <PrimaryButton title={t('common.edit')} variant="secondary" onPress={() => setEditing(true)} />
              <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
                <Text style={styles.deleteLabel}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <MedicationForm value={draft} onChange={setDraft} />
            <View style={styles.actionsRow}>
              <PrimaryButton title={t('common.save')} onPress={handleSave} loading={busy} />
              <PrimaryButton
                title={t('common.cancel')}
                variant="secondary"
                onPress={() => {
                  setDraft(medication);
                  setEditing(false);
                }}
              />
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
