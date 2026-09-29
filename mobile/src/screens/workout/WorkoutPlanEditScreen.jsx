import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme/theme';
import { createWorkoutPlan, fetchWorkoutExercises } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { showAlert } from '../../utils/alert';

function Step({ label, value, onChange, min, max, step = 1 }) {
  return (
    <View style={styles.stepRow}>
      <Text style={typography.bodySecondary}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity onPress={() => onChange(Math.max(min, value - step))} style={styles.btn} accessibilityLabel={`${label} -`}><Text style={typography.heading}>−</Text></TouchableOpacity>
        <Text style={[typography.heading, styles.val]}>{value}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(max, value + step))} style={styles.btn} accessibilityLabel={`${label} +`}><Text style={typography.heading}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

export default function WorkoutPlanEditScreen({ navigation }) {
  const t = useT();
  const [catalogue, setCatalogue] = useState([]);
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchWorkoutExercises().then((d) => setCatalogue(d.exercises)).catch(() => {});
  }, []);

  const add = (ex) => setRows((r) => [...r, { key: `${ex.id}-${r.length}`, ex, sets: 3, reps: 10, hold: 30, rest: 60 }]);
  const patch = (key, fields) => setRows((r) => r.map((row) => (row.key === key ? { ...row, ...fields } : row)));

  async function save() {
    setBusy(true);
    try {
      await createWorkoutPlan({
        name,
        exercises: rows.map((r) => ({
          exerciseId: r.ex.id,
          targetSets: r.sets,
          targetReps: r.ex.is_hold ? undefined : r.reps,
          targetHoldSeconds: r.ex.is_hold ? r.hold : undefined,
          targetRestSeconds: r.rest,
        })),
      });
      navigation.goBack();
    } catch (err) {
      showAlert(t('workout.saveFailed'), err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t('workout.planName')} maxLength={80} />
        {rows.map((r) => (
          <View key={r.key} style={styles.card}>
            <Text style={typography.heading}>{r.ex.name}</Text>
            <Step label={t('workout.sets')} value={r.sets} onChange={(v) => patch(r.key, { sets: v })} min={1} max={10} />
            {r.ex.is_hold
              ? <Step label={t('workout.holdSeconds')} value={r.hold} onChange={(v) => patch(r.key, { hold: v })} min={10} max={300} step={5} />
              : <Step label={t('workout.reps')} value={r.reps} onChange={(v) => patch(r.key, { reps: v })} min={1} max={50} />}
            <Step label={t('workout.restSeconds')} value={r.rest} onChange={(v) => patch(r.key, { rest: v })} min={0} max={300} step={15} />
          </View>
        ))}
        <Text style={typography.heading}>{t('workout.addExercise')}</Text>
        <View style={styles.chips}>
          {catalogue.map((ex) => (
            <TouchableOpacity key={ex.id} style={styles.chip} onPress={() => add(ex)} accessibilityRole="button">
              <Text style={typography.body}>+ {ex.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <PrimaryButton title={t('workout.savePlan')} disabled={!name.trim() || rows.length === 0} loading={busy} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontSize: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  val: { minWidth: 44, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
