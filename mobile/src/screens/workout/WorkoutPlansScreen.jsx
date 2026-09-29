import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import { deleteWorkoutPlan, fetchWorkoutPlan, fetchWorkoutPlans, runWorkoutPlan } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { showAlert } from '../../utils/alert';

// Turns a stored plan-exercise row into the LiveWorkout route params.
export function sessionParams(session, plan, index, queue) {
  const e = plan.exercises[index];
  return {
    workoutId: session.id,
    exerciseId: e.exercise_id,
    targetSets: e.target_sets,
    targetReps: e.target_reps ?? undefined,
    targetHoldSeconds: e.target_hold_seconds ?? undefined,
    targetRestSeconds: e.target_rest_seconds ?? 60,
    tempo: e.target_tempo_down_seconds != null || e.target_tempo_up_seconds != null
      ? { down: Number(e.target_tempo_down_seconds) || 0, pause: Number(e.target_tempo_pause_seconds) || 0, up: Number(e.target_tempo_up_seconds) || 0 }
      : undefined,
    coachLevel: 'full',
    queue,
    queueIndex: index,
  };
}

export default function WorkoutPlansScreen({ navigation }) {
  const t = useT();
  const [plans, setPlans] = useState(null);

  const load = useCallback(() => {
    fetchWorkoutPlans().then((d) => setPlans(d.plans)).catch(() => setPlans([]));
  }, []);
  useFocusEffect(load);

  async function run(planId) {
    try {
      const [plan, { sessions }] = await Promise.all([fetchWorkoutPlan(planId), runWorkoutPlan(planId)]);
      // The remaining exercises travel with the route so the summary screen
      // can offer "Next exercise" without another lookup.
      const queue = sessions.map((s, i) => ({ id: s.id, name: plan.exercises[i].exercise_name, params: sessionParams(s, plan, i, null) }));
      navigation.navigate('LiveWorkout', { ...queue[0].params, queue: queue.map(({ id, name, params }) => ({ id, name, params })), queueIndex: 0 });
    } catch (err) {
      showAlert(t('workout.saveFailed'), err.message);
    }
  }

  function confirmDelete(plan) {
    showAlert(plan.name, '', [
      { text: t('workout.deletePlan'), style: 'destructive', onPress: () => deleteWorkoutPlan(plan.id).then(load) },
      { text: t('workout.resume'), style: 'cancel' },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PrimaryButton title={t('workout.newPlan')} onPress={() => navigation.navigate('WorkoutPlanEdit')} />
        {plans && plans.length === 0 && <Text style={typography.bodySecondary}>{t('workout.noPlans')}</Text>}
        {(plans || []).map((p) => (
          <View key={p.id} style={styles.card}>
            <Text style={typography.body}>{p.name}</Text>
            <Text style={typography.bodySecondary}>{t('workout.planExercises', { count: p.exercise_count })}</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={() => run(p.id)} accessibilityRole="button"><Text style={styles.link}>{t('workout.runPlan')}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(p)} accessibilityRole="button"><Text style={[styles.link, { color: colors.danger }]}>{t('workout.deletePlan')}</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, ...cardShadow },
  row: { flexDirection: 'row', gap: spacing.lg },
  link: { ...typography.body, color: colors.primary, fontWeight: '700' },
});
