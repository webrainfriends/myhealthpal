import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityRings from '../components/ActivityRings';
import PrimaryButton from '../components/PrimaryButton';
import SpeakButton from '../components/SpeakButton';
import { activityRingColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchActivitySummary, logActivity } from '../api/client';
import { useT } from '../i18n/I18nContext';
import { showAlert } from '../utils/alert';
import { parseCalendarDate } from '../utils/date';

function RingLegendRow({ label, value, unit, goal, color }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={typography.body} numberOfLines={1}>
        {label}
      </Text>
      <Text style={typography.bodySecondary}>
        {value ?? 0}
        {unit} / {goal}
        {unit}
      </Text>
    </View>
  );
}

// Calories/distance come from imported wearable exports (see
// activityImportService.js) - there's no goal or ring for them, just a
// factual readout, so they're skipped entirely on days with neither value.
function ImportedStatsRow({ caloriesBurned, distanceMeters, t }) {
  if (caloriesBurned === null && distanceMeters === null) return null;
  return (
    <View style={styles.importedStatsRow}>
      {caloriesBurned !== null && (
        <Text style={typography.bodySecondary}>{t('activity.caloriesBurned', { count: Math.round(caloriesBurned) })}</Text>
      )}
      {distanceMeters !== null && (
        <Text style={typography.bodySecondary}>{(distanceMeters / 1000).toFixed(2)} km</Text>
      )}
    </View>
  );
}

// Builds the sentence SpeakButton reads for today's activity: each ring's
// value against its goal, the same numbers RingLegendRow shows below.
function buildActivitySpeech(current, goals, t) {
  return [
    `${t('activity.move')}: ${current.steps ?? 0}${t('activity.steps')} / ${goals.steps}${t('activity.steps')}.`,
    `${t('activity.exercise')}: ${current.exerciseMinutes ?? 0}${t('activity.min')} / ${goals.exerciseMinutes}${t('activity.min')}.`,
    `${t('activity.stand')}: ${current.standHours ?? 0}${t('activity.hr')} / ${goals.standHours}${t('activity.hr')}.`,
  ].join(' ');
}

function formatDayLabel(dateStr) {
  const d = parseCalendarDate(dateStr);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short' }) : '';
}

function formatFullDayLabel(dateStr) {
  const d = parseCalendarDate(dateStr);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

// A plain-View bar graph (no chart library, consistent with the rest of the
// app - see OrganHealthCard's own note on avoiding react-native-svg for
// simple bars) of daily step counts over the fetched window.
function StepsHistoryChart({ history }) {
  const maxSteps = Math.max(1, ...history.map((day) => day.steps || 0));
  return (
    <View style={styles.chartRow}>
      {history.map((day) => (
        <View key={day.date} style={styles.chartBarColumn}>
          <View style={styles.chartBarTrack}>
            <View
              style={[
                styles.chartBarFill,
                { height: `${Math.max(2, ((day.steps || 0) / maxSteps) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.chartBarLabel}>{formatDayLabel(day.date)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ActivityScreen() {
  const t = useT();
  const [summary, setSummary] = useState(null);
  const [draft, setDraft] = useState({ steps: '', exercise_minutes: '', stand_hours: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchActivitySummary(14);
      setSummary(data);
    } catch (err) {
      console.warn('Failed to load activity', err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setBusy(true);
    try {
      const fields = {};
      if (draft.steps !== '') fields.steps = Number(draft.steps);
      if (draft.exercise_minutes !== '') fields.exercise_minutes = Number(draft.exercise_minutes);
      if (draft.stand_hours !== '') fields.stand_hours = Number(draft.stand_hours);
      await logActivity(fields);
      setDraft({ steps: '', exercise_minutes: '', stand_hours: '' });
      await load();
    } catch (err) {
      showAlert(t('activity.couldNotSave'), err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>{t('activity.loading')}</Text>
      </SafeAreaView>
    );
  }

  const { goals, today, current, isCurrentToday, history } = summary;
  const rings = [
    { percent: current.rings.steps, ...activityRingColors.steps },
    { percent: current.rings.exerciseMinutes, ...activityRingColors.exerciseMinutes },
    { percent: current.rings.standHours, ...activityRingColors.standHours },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.heroCard, cardShadow]}>
          <View style={styles.heroTopRow}>
            {!isCurrentToday && current.date ? (
              <Text style={typography.bodySecondary}>
                {t('activity.lastSynced', { date: formatFullDayLabel(current.date) })}
              </Text>
            ) : (
              <View />
            )}
            <SpeakButton
              text={buildActivitySpeech(current, goals, t)}
              label={t('activity.readAloud')}
            />
          </View>
          <View style={styles.ringsWrap}>
            <ActivityRings rings={rings} size={180} strokeWidth={18} gap={6} />
          </View>
          <View style={styles.legend}>
            <RingLegendRow
              label={t('activity.move')}
              value={current.steps}
              unit={t('activity.steps')}
              goal={goals.steps}
              color={activityRingColors.steps.fg}
            />
            <RingLegendRow
              label={t('activity.exercise')}
              value={current.exerciseMinutes}
              unit={t('activity.min')}
              goal={goals.exerciseMinutes}
              color={activityRingColors.exerciseMinutes.fg}
            />
            <RingLegendRow
              label={t('activity.stand')}
              value={current.standHours}
              unit={t('activity.hr')}
              goal={goals.standHours}
              color={activityRingColors.standHours.fg}
            />
          </View>
          <ImportedStatsRow caloriesBurned={current.caloriesBurned} distanceMeters={current.distanceMeters} t={t} />
        </View>

        <View style={styles.section}>
          <Text style={[typography.heading, styles.sectionHeading]}>{t('activity.logToday')}</Text>
          <View style={styles.formRow}>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t('activity.stepsLabel')}</Text>
              <TextInput
                style={styles.input}
                value={draft.steps}
                onChangeText={(text) => setDraft((d) => ({ ...d, steps: text }))}
                placeholder={String(today.steps ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t('activity.exerciseLabel')}</Text>
              <TextInput
                style={styles.input}
                value={draft.exercise_minutes}
                onChangeText={(text) => setDraft((d) => ({ ...d, exercise_minutes: text }))}
                placeholder={String(today.exerciseMinutes ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t('activity.standLabel')}</Text>
              <TextInput
                style={styles.input}
                value={draft.stand_hours}
                onChangeText={(text) => setDraft((d) => ({ ...d, stand_hours: text }))}
                placeholder={String(today.standHours ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <PrimaryButton title={t('activity.save')} onPress={handleSave} loading={busy} />
        </View>

        <View style={styles.section}>
          <Text style={[typography.heading, styles.sectionHeading]}>
            {t('activity.stepsHistory', { count: history.length })}
          </Text>
          <StepsHistoryChart history={history} />
        </View>
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
    alignItems: 'center',
    gap: spacing.md,
  },
  heroTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ringsWrap: {
    width: 180,
    height: 180,
  },
  legend: {
    width: '100%',
    gap: spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  importedStatsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: 2,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeading: {
    marginBottom: 2,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  formField: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surface,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 140,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  chartBarColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    gap: 4,
  },
  chartBarTrack: {
    flex: 1,
    width: 10,
    justifyContent: 'flex-end',
  },
  chartBarFill: {
    width: '100%',
    minHeight: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
  },
  chartBarLabel: {
    fontSize: 10,
    color: colors.textTertiary,
  },
});
