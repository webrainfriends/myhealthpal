import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import { deleteWorkouts, fetchWorkoutAnalytics, fetchWorkoutHistory } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { showAlert } from '../../utils/alert';

export default function WorkoutCoachHomeScreen({ navigation }) {
  const t = useT();
  const [history, setHistory] = useState(null);
  const [analytics, setAnalytics] = useState([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetchWorkoutHistory()
      .then((data) => setHistory(data.workouts))
      .catch(() => setHistory([]));
    fetchWorkoutAnalytics()
      .then((data) => setAnalytics(data.exercises))
      .catch(() => {});
  }, []);

  useFocusEffect(load);

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = history && history.length > 0 && selected.size === history.length;

  function confirmDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    showAlert(t('workout.deleteWorkoutsTitle', { count: ids.length }), t('workout.deleteWorkoutsBody'), [
      {
        text: t('workout.deleteSelected', { count: ids.length }),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            // The server removes them in batches of up to 50.
            for (let i = 0; i < ids.length; i += 50) await deleteWorkouts(ids.slice(i, i + 50));
            exitSelecting();
            load();
          } catch (err) {
            showAlert(t('workout.deleteFailed'), err.message);
          } finally {
            setDeleting(false);
          }
        },
      },
      { text: t('workout.cancel'), style: 'cancel' },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.bodySecondary}>{t('workout.disclaimer')}</Text>
        <PrimaryButton title={t('workout.startWorkout')} onPress={() => navigation.navigate('WorkoutSetup')} />
        <PrimaryButton variant="secondary" title={t('workout.myPlans')} onPress={() => navigation.navigate('WorkoutPlans')} />
        {analytics.length > 0 && (
          <View style={styles.card}>
            <Text style={typography.heading}>{t('workout.progressTitle')}</Text>
            {analytics.map((a) => (
              <Text key={a.exerciseId} style={typography.bodySecondary}>
                {t('workout.progressLine', { name: a.name, sessions: a.sessions, reps: a.totalValidReps, best: a.bestSetReps ?? '-' })}
                {a.direction ? ` · ${t(`workout.dir${a.direction[0].toUpperCase()}${a.direction.slice(1)}`)}` : ''}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.headerRow}>
          <Text style={typography.heading}>{t('workout.recent')}</Text>
          {history && history.length > 0 && (
            <View style={styles.headerActions}>
              {selecting && (
                <TouchableOpacity
                  onPress={() => setSelected(allSelected ? new Set() : new Set(history.map((w) => w.id)))}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>{t('workout.selectAll')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={selecting ? exitSelecting : () => setSelecting(true)} accessibilityRole="button">
                <Text style={styles.link}>{selecting ? t('workout.cancel') : t('workout.select')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {history && history.length === 0 && <Text style={typography.bodySecondary}>{t('workout.noHistory')}</Text>}
        {(history || []).map((w) => {
          const isSelected = selected.has(w.id);
          return (
            <TouchableOpacity
              key={w.id}
              style={[styles.card, styles.historyCard, isSelected && styles.cardSelected]}
              onPress={() => (selecting ? toggle(w.id) : navigation.navigate('WorkoutSummary', { workoutId: w.id }))}
              // Touch shortcut: press and hold a card to start selecting.
              onLongPress={() => {
                setSelecting(true);
                toggle(w.id);
              }}
              accessibilityRole={selecting ? 'checkbox' : 'button'}
              accessibilityState={selecting ? { checked: isSelected } : undefined}
            >
              {selecting && (
                <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                  {isSelected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={typography.body}>{w.exercise_name}</Text>
                <Text style={typography.bodySecondary}>
                  {new Date(w.completed_at).toLocaleDateString()} · {w.valid_reps} reps
                  {w.estimated_calories_low != null ? ` · ${w.estimated_calories_low}-${w.estimated_calories_high} kcal` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {selecting && (
        <View style={styles.deleteBar}>
          <PrimaryButton
            title={t('workout.deleteSelected', { count: selected.size })}
            disabled={selected.size === 0}
            loading={deleting}
            onPress={confirmDelete}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: 4, ...cardShadow },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', gap: spacing.md },
  link: { ...typography.body, color: colors.primary, fontWeight: '700' },
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardBody: { flex: 1, gap: 4 },
  cardSelected: { borderWidth: 2, borderColor: colors.primary },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: colors.onBrand, fontWeight: '800' },
  deleteBar: { padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
