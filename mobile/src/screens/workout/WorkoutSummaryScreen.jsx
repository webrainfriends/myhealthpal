import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import { completeWorkout, deleteWorkouts, fetchWorkoutSummary } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { showAlert } from '../../utils/alert';
import WorkoutRecordingCard from './WorkoutRecordingCard';
import { fetchWorkoutHealth } from '../../health/workoutHealth';

const pct = (v) => (v == null ? null : `${Math.round(v * 100)}%`);

// Shows the stored, measured components - not a single opaque score - plus
// the grounded AI/template summary and the calorie range with its inputs.
export default function WorkoutSummaryScreen({ route, navigation }) {
  const t = useT();
  const { workoutId, activeSeconds, complete, queue, queueIndex, useHeartRate, startedAtMs } = route.params;
  const next = queue && queueIndex != null ? queue[queueIndex + 1] : null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      // First arrival from a live session completes it (idempotent on the server).
      if (!complete) {
        setData(await fetchWorkoutSummary(workoutId));
        return;
      }
      // Heart rate/active energy for the workout window, only if the user opted in.
      let health = null;
      if (useHeartRate && startedAtMs) {
        health = await fetchWorkoutHealth(startedAtMs, Date.now()).catch(() => null);
      }
      setData(await completeWorkout(workoutId, {
        activeSeconds,
        heartRate: health && health.samples.length ? { source: health.source, samples: health.samples } : undefined,
        deviceActiveKcal: health?.activeKcal || undefined,
      }));
    } catch (err) {
      setError(true);
    }
  }, [workoutId, activeSeconds, complete, useHeartRate, startedAtMs]);

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
    ['aTempo', a.tempoAdherence],
    ['aSymmetry', a.symmetry],
    ['aHrZone', a.heartRateZoneTime],
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

        {(m?.trend || m?.tempo) && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.trendTitle')}</Text>
            {m.tempo?.actual && (
              <>
                <Text style={typography.body}>{t('workout.tempoActual', { down: m.tempo.actual.downSeconds, up: m.tempo.actual.upSeconds ?? '-' })}</Text>
                {m.tempo.planned && <Text style={typography.bodySecondary}>{t('workout.tempoPlanned', { down: m.tempo.planned.down ?? '-', up: m.tempo.planned.up ?? '-' })}</Text>}
              </>
            )}
            {m.trend && <Text style={typography.bodySecondary}>{m.trend.fatigueDetected ? t('workout.trendFatigue') : t('workout.trendSteady')}</Text>}
          </View>
        )}

        {m?.comparison && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.compareTitle')}</Text>
            <Text style={typography.body}>
              {t('workout.compareReps', {
                current: m.comparison.validReps.current,
                previous: m.comparison.validReps.previous,
                change: `${m.comparison.validReps.change >= 0 ? '+' : ''}${m.comparison.validReps.change}`,
              })}
            </Text>
          </View>
        )}

        {data.heartRate && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.heartRate')}</Text>
            <Text style={typography.body}>{t('workout.hrAvgMax', { avg: data.heartRate.avgBpm, max: data.heartRate.maxBpm })}</Text>
            {data.heartRate.zone && (
              <Text style={typography.bodySecondary}>{t('workout.hrZone', { low: data.heartRate.zone.low, high: data.heartRate.zone.high })}</Text>
            )}
          </View>
        )}

        {data.calories && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.calories')}</Text>
            <Text style={typography.title}>{data.calories.low}–{data.calories.high} kcal</Text>
            <Text style={typography.bodySecondary}>{t('workout.caloriesConfidence', { level: data.calories.confidence })}</Text>
            <Text style={typography.bodySecondary}>{t('workout.caloriesInputs', { inputs: data.calories.inputs.sources.join(', ') })}</Text>
          </View>
        )}

        <WorkoutRecordingCard workoutId={workoutId} navigation={navigation} />

        <Text style={typography.bodySecondary}>{t('workout.disclaimer')}</Text>
        {next && (
          <PrimaryButton
            title={t('workout.nextExercise', { name: next.name })}
            onPress={() => navigation.replace('LiveWorkout', { ...next.params, queue, queueIndex: queueIndex + 1 })}
          />
        )}
        <PrimaryButton variant={next ? 'secondary' : 'primary'} title={t('workout.done')} onPress={() => navigation.popToTop()} />
        <PrimaryButton
          variant="secondary"
          title={t('workout.deleteWorkout')}
          onPress={() =>
            showAlert(t('workout.deleteWorkoutsTitle', { count: 1 }), t('workout.deleteWorkoutsBody'), [
              {
                text: t('workout.deleteWorkout'),
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteWorkouts([workoutId]);
                    navigation.popToTop();
                  } catch (err) {
                    showAlert(t('workout.deleteFailed'), err.message);
                  }
                },
              },
              { text: t('workout.cancel'), style: 'cancel' },
            ])
          }
        />
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
