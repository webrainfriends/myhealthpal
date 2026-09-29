import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import { completeWorkout, fetchWorkoutSummary } from '../../api/client';
import { useT } from '../../i18n/I18nContext';

const pct = (v) => (v == null ? null : `${Math.round(v * 100)}%`);

// Shows the stored, measured components - not a single opaque score - plus
// the grounded AI/template summary and the calorie range with its inputs.
export default function WorkoutSummaryScreen({ route, navigation }) {
  const t = useT();
  const { workoutId, activeSeconds, complete } = route.params;
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      // First arrival from a live session completes it (idempotent on the server).
      setData(complete ? await completeWorkout(workoutId, { activeSeconds }) : await fetchWorkoutSummary(workoutId));
    } catch (err) {
      setError(true);
    }
  }, [workoutId, activeSeconds, complete]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={typography.body}>{t('workout.saveFailed')}</Text>
          <PrimaryButton title={t('workout.retry')} onPress={load} />
        </View>
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  const a = data.adherence || {};
  const rows = [
    ['aPlannedReps', a.plannedRepsAchieved],
    ['aSets', a.setsCompleted],
    ['aForm', a.correctFormRatio],
    ['aRom', a.rangeOfMotionQuality],
    ['aRest', a.restAdherence],
  ];
  const m = data.metrics;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.title}>{data.exercise.name}</Text>
        {m && (
          <Text style={typography.bodySecondary}>
            {data.exercise.is_hold
              ? t('workout.held', { seconds: m.totalHoldSeconds, target: (data.target.holdSeconds || 0) * data.target.sets })
              : t('workout.validPartial', { valid: m.validReps, partial: m.partialReps })}
          </Text>
        )}

        <View style={styles.card}>
          <Text style={typography.heading}>{t('workout.summary')}</Text>
          <Text style={typography.body}>{data.summaryText}</Text>
        </View>

        <View style={styles.card}>
          <Text style={typography.heading}>{t('workout.adherence')}</Text>
          {rows.map(([key, value]) => (
            <View key={key} style={styles.row}>
              <Text style={typography.body}>{t(`workout.${key}`)}</Text>
              <Text style={typography.bodySecondary}>{pct(value) ?? t('workout.notMeasured')}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={typography.body}>{t('workout.duration')}</Text>
            <Text style={typography.bodySecondary}>{Math.round((data.activeSeconds || 0) / 60 * 10) / 10} min</Text>
          </View>
        </View>

        {data.calories && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.calories')}</Text>
            <Text style={typography.title}>{data.calories.low}–{data.calories.high} kcal</Text>
            <Text style={typography.bodySecondary}>{t('workout.caloriesConfidence', { level: data.calories.confidence })}</Text>
            <Text style={typography.bodySecondary}>{t('workout.caloriesInputs', { inputs: data.calories.inputs.sources.join(', ') })}</Text>
          </View>
        )}

        <Text style={typography.bodySecondary}>{t('workout.disclaimer')}</Text>
        <PrimaryButton title={t('workout.done')} onPress={() => navigation.popToTop()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, ...cardShadow },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
