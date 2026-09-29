import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import { fetchWorkoutHistory } from '../../api/client';
import { useT } from '../../i18n/I18nContext';

export default function WorkoutCoachHomeScreen({ navigation }) {
  const t = useT();
  const [history, setHistory] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchWorkoutHistory()
        .then((data) => active && setHistory(data.workouts))
        .catch(() => active && setHistory([]));
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>{t('workout.disclaimer')}</Text>
        <PrimaryButton title={t('workout.startWorkout')} onPress={() => navigation.navigate('WorkoutSetup')} />
        <PrimaryButton variant="secondary" title={t('workout.myPlans')} onPress={() => navigation.navigate('WorkoutPlans')} />
        <Text style={typography.heading}>{t('workout.recent')}</Text>
        {history && history.length === 0 && <Text style={typography.bodySecondary}>{t('workout.noHistory')}</Text>}
        {(history || []).map((w) => (
          <TouchableOpacity
            key={w.id}
            style={styles.card}
            onPress={() => navigation.navigate('WorkoutSummary', { workoutId: w.id })}
            accessibilityRole="button"
          >
            <Text style={typography.body}>{w.exercise_name}</Text>
            <Text style={typography.bodySecondary}>
              {new Date(w.completed_at).toLocaleDateString()} · {w.valid_reps} reps
              {w.estimated_calories_low != null ? ` · ${w.estimated_calories_low}-${w.estimated_calories_high} kcal` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: 4, ...cardShadow },
});
