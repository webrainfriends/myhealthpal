import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme/theme';
import { createWorkout, startWorkout } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { getExercise } from '../../workout/engine/exerciseConfigs';
import { createWorkoutRunner } from '../../workout/engine/workoutRunner';
import { missingLandmarks } from '../../workout/engine/measure';
import { getCameraPermission, getPoseCameraComponent, isPoseTrackingAvailable, requestCameraPermission } from '../../workout/poseNative';
import useLiveCoach from '../../workout/hooks/useLiveCoach';
import useWorkoutSync from '../../workout/hooks/useWorkoutSync';
import { showAlert } from '../../utils/alert';
import { setRecording } from '../../workout/recordingStore';

const VISIBILITY = 0.5;
const READY_FRAMES = 15; // ~1s of continuous good visibility before tracking starts
const SAMPLE_MS = 200; // landmark samples for the replay overlay: 5 per second
const PART_LABELS = { HIP: 'hips', KNEE: 'knees', ANKLE: 'ankles', SHOULDER: 'shoulders', ELBOW: 'elbows', WRIST: 'wrists' };

// Camera setup -> live tracking -> rest -> save, in one screen. All counting
// and form checks run locally in the workout runner; the server is only
// contacted to create/start the session and to sync finished sets in batches.
export default function LiveWorkoutScreen({ route, navigation }) {
  const t = useT();
  const cfg = route.params;
  const exercise = useMemo(() => getExercise(cfg.exerciseId), [cfg.exerciseId]);
  const runner = useMemo(
    () => createWorkoutRunner({ exercise, targetSets: cfg.targetSets, targetReps: cfg.targetReps, targetHoldSeconds: cfg.targetHoldSeconds, targetRestSeconds: cfg.targetRestSeconds, tempo: cfg.tempo }),
    [exercise, cfg]
  );
  const coach = useLiveCoach(cfg.coachLevel);

  const [permission, setPermission] = useState('checking');
  const [stage, setStage] = useState('setup'); // setup | live | paused | rest | saving
  const [missing, setMissing] = useState(exercise.required.map((n) => n.replace(/^(LEFT|RIGHT)_/, '')));
  const [view, setView] = useState({ valid: 0, partial: 0, invalid: 0, heldSeconds: 0, setNumber: 1, paused: true });
  const [cue, setCue] = useState(null);
  const [lastTempo, setLastTempo] = useState(null);
  const [restLeft, setRestLeft] = useState(0);
  const [workoutId, setWorkoutId] = useState(null);
  const [failed, setFailed] = useState(false);
  const readyFrames = useRef(0);
  const validAnnounced = useRef(0);
  // Optional recording (opt-in): file path promise + sampled landmarks.
  const cameraRef = useRef(null);
  const recording = useRef({ promise: null, startedAt: null, frames: [], lastSampleAt: 0 });
  const stageRef = useRef('setup');
  const sync = useWorkoutSync(workoutId);
  const PoseCamera = useMemo(() => getPoseCameraComponent(), []);

  const go = (next) => {
    stageRef.current = next;
    setStage(next);
  };

  useEffect(() => {
    getCameraPermission().then(setPermission);
  }, []);

  // Rest countdown (UI only; the runner records the real elapsed rest).
  useEffect(() => {
    if (stage !== 'rest') return undefined;
    const id = setInterval(() => {
      const left = Math.max(0, runner.targetRestSeconds - Math.round((Date.now() - runner.restStartedAt) / 1000));
      setRestLeft(left);
      if (left === 0) resumeAfterRest();
    }, 500);
    return () => clearInterval(id);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  function resumeAfterRest() {
    runner.startNextSet(Date.now());
    coach.announce(`Set ${runner.setNumber}`);
    go('live');
  }

  const beginTracking = useCallback(async () => {
    try {
      // A plan run has already created its sessions; a quick start creates one now.
      const id = cfg.workoutId || (await createWorkout({
        exerciseId: cfg.exerciseId,
        targetSets: cfg.targetSets,
        targetReps: cfg.targetReps,
        targetHoldSeconds: cfg.targetHoldSeconds,
        targetRestSeconds: cfg.targetRestSeconds,
        tempoDownSeconds: cfg.tempo?.down,
        tempoPauseSeconds: cfg.tempo?.pause,
        tempoUpSeconds: cfg.tempo?.up,
      })).id;
      await startWorkout(id);
      setWorkoutId(id);
      if (cfg.recordVideo && cameraRef.current) {
        // The local file is a temp recording; nothing leaves the phone until
        // the user chooses to save it (WorkoutRecordingCard).
        recording.current = { promise: cameraRef.current.startRecording().catch(() => null), startedAt: Date.now(), frames: [], lastSampleAt: 0 };
      }
      go('live');
    } catch (err) {
      setFailed(true);
    }
  }, [cfg]);

  const onLandmarks = useCallback(
    (lm) => {
      const now = Date.now();
      if (stageRef.current === 'setup') {
        const miss = missingLandmarks(lm, exercise.required, VISIBILITY);
        setMissing(miss);
        readyFrames.current = miss.length === 0 ? readyFrames.current + 1 : 0;
        if (readyFrames.current >= READY_FRAMES) {
          readyFrames.current = 0;
          go('starting');
          beginTracking();
        }
        return;
      }
      if (stageRef.current !== 'live') return;

      const rec = recording.current;
      if (rec.startedAt && now - rec.lastSampleAt >= SAMPLE_MS && Object.keys(lm).length > 0) {
        rec.lastSampleAt = now;
        const sample = {};
        for (const [name, p] of Object.entries(lm)) if (p.c >= 0.3) sample[name] = [Number(p.x.toFixed(3)), Number(p.y.toFixed(3))];
        rec.frames.push({ t: now - rec.startedAt, lm: sample });
      }

      const { events, paused } = runner.feed(lm, now);
      for (const ev of events) {
        if (ev.type === 'rep') {
          const r = ev.rep;
          if (r.classification === 'valid') validAnnounced.current += 1;
          if (r.eccentricMs != null) setLastTempo({ down: r.eccentricMs / 1000, up: r.concentricMs / 1000 });
          coach.announceRep(validAnnounced.current, r.classification, exercise.cues?.partial);
        } else if (ev.type === 'cue') {
          setCue(ev.message);
          coach.cue(ev.ruleCode, ev.severity, ev.message);
        } else if (ev.type === 'set_complete') {
          validAnnounced.current = 0;
          sync.enqueue(runner.sets);
          sync.flush();
          if (runner.phase === 'rest') {
            coach.announce(t('workout.setComplete', { seconds: cfg.targetRestSeconds }));
            go('rest');
          } else {
            finishWorkout();
          }
        }
      }
      setView({ ...runner.current, setNumber: runner.setNumber, paused });
    },
    [exercise, runner, coach, sync, beginTracking, cfg, t] // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function finishWorkout() {
    go('saving');
    const sets = runner.finish(Date.now());
    coach.stop();
    if (recording.current.startedAt) {
      await cameraRef.current?.stopRecording().catch(() => {});
      const path = await recording.current.promise;
      if (path && workoutId) setRecording(workoutId, { path, frames: recording.current.frames, fps: 1000 / SAMPLE_MS });
      recording.current = { promise: null, startedAt: null, frames: [], lastSampleAt: 0 };
    }
    if (sets.length === 0) {
      navigation.goBack();
      return;
    }
    sync.enqueue(sets);
    const ok = await sync.flush();
    if (!ok) {
      setFailed(true);
      return;
    }
    navigation.replace('WorkoutSummary', { workoutId, activeSeconds: runner.activeSeconds, complete: true, queue: cfg.queue, queueIndex: cfg.queueIndex });
  }

  function confirmEnd() {
    showAlert(t('workout.endWorkout'), '', [
      { text: t('workout.endWorkout'), onPress: finishWorkout },
      { text: t('workout.resume'), style: 'cancel' },
    ]);
  }

  if (permission === 'checking') return <SafeAreaView style={styles.dark} />;

  if (!isPoseTrackingAvailable()) {
    return (
      <SafeAreaView style={styles.dark}>
        <View style={styles.center}>
          <Text style={styles.lightText}>{t('workout.cameraUnavailable')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permission !== 'granted') {
    return (
      <SafeAreaView style={styles.dark}>
        <View style={styles.center}>
          <Text style={styles.lightText}>{t('workout.cameraNeeded')}</Text>
          <PrimaryButton title={t('workout.allowCamera')} onPress={async () => setPermission(await requestCameraPermission())} />
        </View>
      </SafeAreaView>
    );
  }

  if (failed) {
    return (
      <SafeAreaView style={styles.dark}>
        <View style={styles.center}>
          <Text style={styles.lightText}>{t('workout.saveFailed')}</Text>
          <PrimaryButton
            title={t('workout.retry')}
            onPress={async () => {
              setFailed(false);
              if (!workoutId) return beginTracking();
              return finishWorkout();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const isHold = exercise.kind === 'hold';
  const showRest = stage === 'rest';

  return (
    <View style={styles.dark}>
      <PoseCamera ref={cameraRef} camera="front" onLandmarks={onLandmarks} onError={() => setFailed(true)} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.badge} accessibilityLiveRegion="polite">
          <Text style={styles.badgeText}>● {cfg.recordVideo && stage !== 'setup' && stage !== 'starting' ? t('workout.recordingNote') : t('workout.cameraActive')}</Text>
        </View>

        {(stage === 'setup' || stage === 'starting') && (
          <View style={styles.panel}>
            <Text style={styles.lightText}>{t('workout.frameYourself')}</Text>
            {missing.length > 0 ? (
              <Text style={styles.lightText}>{t('workout.moveBack', { parts: missing.map((m) => PART_LABELS[m] || m.toLowerCase()).join(', ') })}</Text>
            ) : (
              <Text style={styles.lightText}>{t('workout.ready')}</Text>
            )}
          </View>
        )}

        {(stage === 'live' || showRest) && (
          <View style={styles.panel}>
            <Text style={styles.title}>{exercise.name.toUpperCase()}</Text>
            <Text style={styles.lightText}>{t('workout.setOf', { set: view.setNumber, total: cfg.targetSets })}</Text>
            {isHold ? (
              <Text style={styles.big}>{t('workout.held', { seconds: view.heldSeconds, target: cfg.targetHoldSeconds })}</Text>
            ) : (
              <>
                <Text style={styles.big}>{t('workout.repsOf', { done: view.valid, target: cfg.targetReps })}</Text>
                <Text style={styles.lightText}>{t('workout.validPartial', { valid: view.valid, partial: view.partial })}</Text>
              </>
            )}
            {lastTempo && !showRest && (
              <Text style={styles.lightText}>{t('workout.tempoActual', { down: lastTempo.down.toFixed(1), up: lastTempo.up.toFixed(1) })}</Text>
            )}
            {view.paused && !showRest && <Text style={styles.warn}>{t('workout.frameYourself')}</Text>}
            {cue && !showRest && <Text style={styles.warn}>⚠ {cue}</Text>}
            {showRest && (
              <>
                <Text style={styles.big}>{t('workout.restLeft', { seconds: restLeft })}</Text>
                <PrimaryButton title={t('workout.skipRest')} onPress={resumeAfterRest} />
              </>
            )}
            <View style={styles.buttons}>
              {!showRest && (
                <PrimaryButton
                  variant="secondary"
                  title={stage === 'paused' ? t('workout.resume') : t('workout.pause')}
                  onPress={() => go(stage === 'paused' ? 'live' : 'paused')}
                />
              )}
              <PrimaryButton title={t('workout.endWorkout')} onPress={confirmEnd} />
            </View>
          </View>
        )}

        {stage === 'saving' && (
          <View style={styles.panel}>
            <Text style={styles.lightText}>{t('workout.saving')}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md, gap: spacing.md },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.md },
  badge: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeText: { color: colors.danger, fontWeight: '700' },
  panel: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  lightText: { ...typography.body, color: colors.onBrand, textAlign: 'center' },
  title: { ...typography.heading, color: colors.onBrand },
  big: { fontSize: 32, fontWeight: '800', color: colors.onBrand },
  warn: { ...typography.body, color: colors.warning, fontWeight: '700' },
  buttons: { gap: spacing.sm },
});
