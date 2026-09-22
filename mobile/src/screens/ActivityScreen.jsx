import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityRings from '../components/ActivityRings';
import PrimaryButton from '../components/PrimaryButton';
import { activityRingColors, cardShadow, colors, radii, spacing, typography } from '../theme/theme';
import { fetchActivitySummary, logActivity } from '../api/client';
import { showAlert } from '../utils/alert';

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
function ImportedStatsRow({ caloriesBurned, distanceMeters }) {
  if (caloriesBurned === null && distanceMeters === null) return null;
  return (
    <View style={styles.importedStatsRow}>
      {caloriesBurned !== null && (
        <Text style={typography.bodySecondary}>{Math.round(caloriesBurned)} cal burned</Text>
      )}
      {distanceMeters !== null && (
        <Text style={typography.bodySecondary}>{(distanceMeters / 1000).toFixed(2)} km</Text>
      )}
    </View>
  );
}

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatFullDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
      showAlert('Could not save activity', err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={[typography.bodySecondary, styles.centeredText]}>Loading…</Text>
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
          {!isCurrentToday && current.date && (
            <Text style={typography.bodySecondary}>Last synced {formatFullDayLabel(current.date)}</Text>
          )}
          <View style={styles.ringsWrap}>
            <ActivityRings rings={rings} size={180} strokeWidth={18} gap={6} />
          </View>
          <View style={styles.legend}>
            <RingLegendRow
              label="Move"
              value={current.steps}
              unit=" steps"
              goal={goals.steps}
              color={activityRingColors.steps.fg}
            />
            <RingLegendRow
              label="Exercise"
              value={current.exerciseMinutes}
              unit=" min"
              goal={goals.exerciseMinutes}
              color={activityRingColors.exerciseMinutes.fg}
            />
            <RingLegendRow
              label="Stand"
              value={current.standHours}
              unit=" hr"
              goal={goals.standHours}
              color={activityRingColors.standHours.fg}
            />
          </View>
          <ImportedStatsRow caloriesBurned={current.caloriesBurned} distanceMeters={current.distanceMeters} />
        </View>

        <View style={styles.section}>
          <Text style={[typography.heading, styles.sectionHeading]}>Log today</Text>
          <View style={styles.formRow}>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Steps</Text>
              <TextInput
                style={styles.input}
                value={draft.steps}
                onChangeText={(t) => setDraft((d) => ({ ...d, steps: t }))}
                placeholder={String(today.steps ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Exercise (min)</Text>
              <TextInput
                style={styles.input}
                value={draft.exercise_minutes}
                onChangeText={(t) => setDraft((d) => ({ ...d, exercise_minutes: t }))}
                placeholder={String(today.exerciseMinutes ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Stand (hr)</Text>
              <TextInput
                style={styles.input}
                value={draft.stand_hours}
                onChangeText={(t) => setDraft((d) => ({ ...d, stand_hours: t }))}
                placeholder={String(today.standHours ?? 0)}
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <PrimaryButton title="Save" onPress={handleSave} loading={busy} />
        </View>

        <View style={styles.section}>
          <Text style={[typography.heading, styles.sectionHeading]}>Steps, last {history.length} days</Text>
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
