import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme/theme';
import { fetchWorkoutExercises } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { getSetting, setSetting } from '../../utils/localSettings';
import { isWorkoutHealthAvailable, requestWorkoutHealthAccess } from '../../health/workoutHealth';
import { showAlert } from '../../utils/alert';

// Optional target heart-rate zones (bpm). Generic ranges - not personalised.
const ZONES = [
  { key: 'zoneEasy', low: 100, high: 130 },
  { key: 'zoneCardio', low: 130, high: 160 },
  { key: 'zoneHard', low: 160, high: 185 },
];
import { LEVELS } from '../../workout/engine/coachThrottle';

function Chip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[typography.body, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stepper({ label, value, onChange, min, max, step = 1 }) {
  return (
    <View style={styles.stepperRow}>
      <Text style={typography.body}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity onPress={() => onChange(Math.max(min, value - step))} accessibilityLabel={`${label} -`} style={styles.stepBtn}>
          <Text style={typography.heading}>−</Text>
        </TouchableOpacity>
        <Text style={[typography.heading, styles.stepValue]}>{value}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(max, value + step))} accessibilityLabel={`${label} +`} style={styles.stepBtn}>
          <Text style={typography.heading}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const LEVEL_KEYS = { off: 'levelOff', count: 'levelCount', minimal: 'levelMinimal', full: 'levelFull' };

export default function WorkoutSetupScreen({ navigation }) {
  const t = useT();
  const [exercises, setExercises] = useState([]);
  const [exerciseId, setExerciseId] = useState('squat');
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [hold, setHold] = useState(30);
  const [rest, setRest] = useState(60);
  const [level, setLevel] = useState(() => getSetting('workout.coachLevel', 'full'));
  const [tempoOn, setTempoOn] = useState(false);
  const [recordVideo, setRecordVideo] = useState(false);
  const [useHeartRate, setUseHeartRate] = useState(false);
  const [zone, setZone] = useState(null);
  const healthOk = isWorkoutHealthAvailable();

  // The OS permission prompt appears only now, when the user opts in.
  async function toggleHeartRate() {
    if (useHeartRate) {
      setUseHeartRate(false);
      setZone(null);
      return;
    }
    try {
      await requestWorkoutHealthAccess();
      setUseHeartRate(true);
    } catch (err) {
      showAlert(t('workout.hrUnavailable'), err.message);
    }
  }
  const [down, setDown] = useState(3);
  const [up, setUp] = useState(2);
  const chooseLevel = (l) => {
    setLevel(l);
    setSetting('workout.coachLevel', l); // remembered on this device
  };

  useEffect(() => {
    fetchWorkoutExercises().then((d) => setExercises(d.exercises)).catch(() => {});
  }, []);

  const selected = exercises.find((e) => e.id === exerciseId);
  const isHold = !!selected?.is_hold;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.heading}>{t('workout.exercise')}</Text>
        <View style={styles.chips}>
          {exercises.map((e) => (
            <Chip key={e.id} label={e.name} selected={e.id === exerciseId} onPress={() => setExerciseId(e.id)} />
          ))}
        </View>
        <Stepper label={t('workout.sets')} value={sets} onChange={setSets} min={1} max={10} />
        {isHold ? (
          <Stepper label={t('workout.holdSeconds')} value={hold} onChange={setHold} min={10} max={300} step={5} />
        ) : (
          <Stepper label={t('workout.reps')} value={reps} onChange={setReps} min={1} max={50} />
        )}
        <Stepper label={t('workout.restSeconds')} value={rest} onChange={setRest} min={0} max={300} step={15} />
        {!isHold && (
          <>
            <Chip label={tempoOn ? t('workout.tempo') : t('workout.tempoOff')} selected={tempoOn} onPress={() => setTempoOn((v) => !v)} />
            {tempoOn && (
              <>
                <Stepper label={t('workout.tempoDown')} value={down} onChange={setDown} min={1} max={8} />
                <Stepper label={t('workout.tempoUp')} value={up} onChange={setUp} min={1} max={8} />
              </>
            )}
          </>
        )}
        <Text style={typography.heading}>{t('workout.coaching')}</Text>
        <View style={styles.chips}>
          {LEVELS.map((l) => (
            <Chip key={l} label={t(`workout.${LEVEL_KEYS[l]}`)} selected={l === level} onPress={() => chooseLevel(l)} />
          ))}
        </View>
        {healthOk && (
          <>
            <Chip label={t('workout.useHeartRate')} selected={useHeartRate} onPress={toggleHeartRate} />
            {useHeartRate && (
              <View style={styles.chips}>
                {ZONES.map((z) => (
                  <Chip key={z.key} label={`${t(`workout.${z.key}`)} ${z.low}-${z.high}`} selected={zone?.key === z.key} onPress={() => setZone(zone?.key === z.key ? null : z)} />
                ))}
              </View>
            )}
          </>
        )}
        <Chip label={t('workout.recordThis')} selected={recordVideo} onPress={() => setRecordVideo((v) => !v)} />
        <Text style={typography.bodySecondary}>{t('workout.disclaimer')}</Text>
        <PrimaryButton
          title={t('workout.continueToCamera')}
          disabled={!selected}
          onPress={() =>
            navigation.navigate('LiveWorkout', {
              exerciseId,
              targetSets: sets,
              targetReps: isHold ? undefined : reps,
              targetHoldSeconds: isHold ? hold : undefined,
              targetRestSeconds: rest,
              coachLevel: level,
              recordVideo,
              useHeartRate,
              hrZone: zone ? { low: zone.low, high: zone.high } : undefined,
              tempo: tempoOn && !isHold ? { down, pause: 0, up } : undefined,
            })
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTextSelected: { color: colors.onBrand },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryMuted, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 48, textAlign: 'center' },
});
