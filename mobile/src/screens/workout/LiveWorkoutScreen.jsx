import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PrimaryButton from '../../components/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme/theme';
import { createWorkout, startWorkout } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { EXERCISES, getExercise } from '../../workout/engine/exerciseConfigs';
import { detectExercise, MIN_FRAMES, readyForDetection } from '../../workout/engine/exerciseDetector';
import { fatigueCheck } from '../../workout/engine/fatigue';
import { createWorkoutRunner } from '../../workout/engine/workoutRunner';
import { missingLandmarks } from '../../workout/engine/measure';
import { getCameraPermission, getPoseCameraComponent, isPoseTrackingAvailable, poseUnavailableReason, requestCameraPermission } from '../../workout/poseNative';
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
  const isAuto = cfg.exerciseId === 'auto';
  // In auto-detect mode the exercise is unknown until the first few seconds
  // of movement have been analysed on-device.
  const [exId, setExId] = useState(isAuto ? null : cfg.exerciseId);
  const exercise = useMemo(() => (exId ? getExercise(exId) : null), [exId]);
  const detected = useRef(null); // { id, confidence } once auto-detect settled
  const detectFrames = useRef([]);
  const restBonus = useRef(0);
  const [fatigueNote, setFatigueNote] = useState(false);
  const runner = useMemo(
    () => (exercise
      ? createWorkoutRunner({ exercise, targetSets: cfg.targetSets, targetReps: cfg.targetReps ?? 10, targetHoldSeconds: cfg.targetHoldSeconds ?? 30, targetRestSeconds: cfg.targetRestSeconds, tempo: cfg.tempo })
      : null),
    [exercise, cfg]
  );
  const coach = useLiveCoach(cfg.coachLevel);

  const [permission, setPermission] = useState('checking');
  const [stage, setStage] = useState('setup'); // setup | live | paused | rest | saving
  const [missing, setMissing] = useState((exercise ? exercise.required : ['SHOULDER', 'HIP']).map((n) => n.replace(/^(LEFT|RIGHT)_/, '')));
  const [view, setView] = useState({ valid: 0, partial: 0, invalid: 0, heldSeconds: 0, setNumber: 1, paused: true });
  const [cue, setCue] = useState(null);
  const [lastTempo, setLastTempo] = useState(null);
  const [restLeft, setRestLeft] = useState(0);
  const [workoutId, setWorkoutId] = useState(null);
  const [failed, setFailed] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const readyFrames = useRef(0);
  const validAnnounced = useRef(0);
  const beganAt = useRef(null);
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
      const left = Math.max(0, runner.targetRestSeconds + restBonus.current - Math.round((Date.now() - runner.restStartedAt) / 1000));
      setRestLeft(left);
      if (left === 0) resumeAfterRest();
    }, 500);
    return () => clearInterval(id);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  function resumeAfterRest() {
    runner.startNextSet(Date.now());
    restBonus.current = 0;
    setFatigueNote(false);
    coach.announce(`Set ${runner.setNumber}`);
    go('live');
  }

  const beginTracking = useCallback(async () => {
    try {
      // A plan run has already created its sessions; a quick start creates one now.
      const auto = detected.current;
      const isHoldEx = auto ? EXERCISES[auto.id].kind === 'hold' : false;
      const id = cfg.workoutId || (await createWorkout({
        exerciseId: auto ? auto.id : cfg.exerciseId,
        exerciseMode: auto ? 'auto' : 'selected',
        detectionConfidence: auto ? auto.confidence : undefined,
        targetSets: cfg.targetSets,
        targetReps: auto ? (isHoldEx ? undefined : cfg.targetReps ?? 10) : cfg.targetReps,
        targetHoldSeconds: auto ? (isHoldEx ? cfg.targetHoldSeconds ?? 30 : undefined) : cfg.targetHoldSeconds,
        targetRestSeconds: cfg.targetRestSeconds,
        tempoDownSeconds: cfg.tempo?.down,
        tempoPauseSeconds: cfg.tempo?.pause,
        tempoUpSeconds: cfg.tempo?.up,
        targetHrZoneLow: cfg.hrZone?.low,
        targetHrZoneHigh: cfg.hrZone?.high,
      })).id;
      await startWorkout(id);
      setWorkoutId(id);
      beganAt.current = Date.now();
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
      if (stageRef.current === 'detecting') {
        // Collect ~3 seconds of frames, then classify on-device.
        detectFrames.current.push(lm);
        if (detectFrames.current.length >= MIN_FRAMES * 2) settleDetection();
        return;
      }
      if (stageRef.current === 'setup' && isAuto && !exercise) {
        const ready = readyForDetection(lm);
        setMissing(ready ? [] : ['SHOULDER', 'HIP']);
        readyFrames.current = ready ? readyFrames.current + 1 : 0;
        if (readyFrames.current >= READY_FRAMES) {
          readyFrames.current = 0;
          detectFrames.current = [];
          go('detecting');
        }
        return;
      }
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
            const fatigue = fatigueCheck(runner.sets);
            restBonus.current = fatigue.fatigued ? 15 : 0;
            setFatigueNote(fatigue.fatigued);
            coach.announce(fatigue.fatigued ? t('workout.fatigueCue') : t('workout.setComplete', { seconds: cfg.targetRestSeconds }));
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

  // Auto-detect: classify the collected frames; low confidence or a close
  // runner-up asks the user instead of silently assigning the exercise.
  function settleDetection() {
    const frames = detectFrames.current;
    detectFrames.current = [];
    go('detect-wait'); // ignore frames while the confirmation is open
    const result = detectExercise(frames);
    const accept = (id, confidence) => {
      detected.current = { id, confidence };
      setExId(id);
      go('starting');
    };
    if (result.exerciseId && !result.needsConfirmation) {
      accept(result.exerciseId, result.confidence);
      return;
    }
    const options = result.candidates.slice(0, 2);
    if (options.length === 0) {
      showAlert(t('workout.detectFailedTitle'), t('workout.detectFailedBody'), [
        { text: t('workout.retry'), onPress: () => go('setup') },
        { text: t('workout.back'), style: 'cancel', onPress: () => navigation.goBack() },
      ]);
      return;
    }
    showAlert(t('workout.detectConfirmTitle'), t('workout.detectConfirmBody'), [
      ...options.map((o) => ({ text: EXERCISES[o.id].name, onPress: () => accept(o.id, o.score) })),
      { text: t('workout.retry'), style: 'cancel', onPress: () => go('setup') },
    ]);
  }

  // Once auto-detect has settled on an exercise, start the session.
  useEffect(() => {
    if (stage === 'starting' && isAuto && exercise && !workoutId) beginTracking();
  }, [stage, exercise]); // eslint-disable-line react-hooks/exhaustive-deps

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
    navigation.replace('WorkoutSummary', { workoutId, activeSeconds: runner.activeSeconds, complete: true, queue: cfg.queue, queueIndex: cfg.queueIndex, useHeartRate: cfg.useHeartRate, startedAtMs: beganAt.current });
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
          <Text style={styles.lightText}>{poseUnavailableReason() === 'insecure_context' ? t('workout.cameraInsecure') : t('workout.cameraUnavailable')}</Text>
          <PrimaryButton title={t('workout.back')} onPress={() => navigation.goBack()} />
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
          <PrimaryButton variant="secondary" title={t('workout.cancel')} onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  if (cameraBlocked) {
    return (
      <SafeAreaView style={styles.dark}>
        <View style={styles.center}>
          <Text style={styles.lightText}>{t('workout.cameraBlocked')}</Text>
          <PrimaryButton title={t('workout.back')} onPress={() => navigation.goBack()} />
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

  const isHold = exercise?.kind === 'hold';
  const showRest = stage === 'rest';
  const active = stage === 'live' || stage === 'paused' || showRest;
  const preparing = stage === 'setup' || stage === 'detecting' || stage === 'detect-wait' || stage === 'starting';

  // Skips the framing check: tracking starts now (auto-detect starts its
  // detection window now). Pose-confidence gating still pauses counting
  // whenever the body isn't visible.
  function startNow() {
    readyFrames.current = 0;
    if (isAuto && !exercise) {
      detectFrames.current = [];
      go('detecting');
      return;
    }
    go('starting');
    beginTracking();
  }

  // Before the workout has started, leaving just goes back; once it is
  // running, the close button behaves like End workout (asks first).
  function close() {
    if (active) confirmEnd();
    else navigation.goBack();
  }

  return (
    <View style={styles.dark}>
      <PoseCamera ref={cameraRef} camera="front" onLandmarks={onLandmarks} onError={(err) => (err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'NotReadableError') ? setCameraBlocked(true) : setFailed(true))} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity style={styles.closeButton} onPress={close} accessibilityRole="button" accessibilityLabel={t('workout.close')} disabled={stage === 'saving'}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.badge} accessibilityLiveRegion="polite">
            <Text style={styles.badgeText}>● {cfg.recordVideo && !preparing ? t('workout.recordingNote') : t('workout.cameraActive')}</Text>
          </View>
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          {(stage === 'detecting' || stage === 'detect-wait') && (
            <View style={styles.panel}>
              <Text style={styles.lightText}>{t('workout.detecting')}</Text>
            </View>
          )}

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

          {(stage === 'live' || stage === 'paused' || showRest) && (
            <View style={styles.panel}>
              <Text style={styles.title}>{exercise?.name.toUpperCase()}</Text>
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
              {stage === 'paused' && <Text style={styles.warn}>{t('workout.paused')}</Text>}
              {stage === 'live' && view.paused && <Text style={styles.warn}>{t('workout.frameYourself')}</Text>}
              {cue && stage === 'live' && <Text style={styles.warn}>⚠ {cue}</Text>}
              {showRest && (
                <>
                  <Text style={styles.big}>{t('workout.restLeft', { seconds: restLeft })}</Text>
                  {fatigueNote && <Text style={styles.warn}>{t('workout.fatigueNote')}</Text>}
                </>
              )}
            </View>
          )}

          {stage === 'saving' && (
            <View style={styles.panel}>
              <Text style={styles.lightText}>{t('workout.saving')}</Text>
            </View>
          )}

          {/* Controls live in their own bar so they are always on screen and
              never depend on the tracking state or the stats card's height. */}
          {stage !== 'saving' && (
            <View style={styles.controls}>
              {stage === 'setup' && (
                <View style={styles.controlCell}>
                  <PrimaryButton title={t('workout.startNow')} onPress={startNow} />
                </View>
              )}
              {preparing && (
                <View style={styles.controlCell}>
                  <PrimaryButton variant="secondary" title={t('workout.cancel')} onPress={() => navigation.goBack()} />
                </View>
              )}
              {showRest && (
                <View style={styles.controlCell}>
                  <PrimaryButton title={t('workout.skipRest')} onPress={resumeAfterRest} />
                </View>
              )}
              {(stage === 'live' || stage === 'paused') && (
                <View style={styles.controlCell}>
                  <PrimaryButton variant="secondary" title={stage === 'paused' ? t('workout.resume') : t('workout.pause')} onPress={() => go(stage === 'paused' ? 'live' : 'paused')} />
                </View>
              )}
              {active && (
                <View style={styles.controlCell}>
                  <PrimaryButton title={t('workout.endWorkout')} onPress={confirmEnd} />
                </View>
              )}
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md, gap: spacing.md },
  overlay: { flex: 1, justifyContent: 'space-between', padding: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.onBrand, fontSize: 20, fontWeight: '700' },
  bottom: { gap: spacing.sm },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  controlCell: { flexGrow: 1, flexBasis: 160 },
  badge: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeText: { color: colors.danger, fontWeight: '700' },
  panel: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  lightText: { ...typography.body, color: colors.onBrand, textAlign: 'center' },
  title: { ...typography.heading, color: colors.onBrand },
  big: { fontSize: 32, fontWeight: '800', color: colors.onBrand },
  warn: { ...typography.body, color: colors.warning, fontWeight: '700' },
  buttons: { gap: spacing.sm },
});
