import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PrimaryButton from '../../components/PrimaryButton';
import { cardShadow, colors, radii, spacing, typography } from '../../theme/theme';
import {
  completeWorkoutVideo, deleteWorkoutVideo, fetchWorkoutVideoStatus, fetchWorkoutVideoUrl,
  markWorkoutVideoLocalDeleted, saveWorkoutPoseSegment, uploadWorkoutVideo,
} from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { showAlert } from '../../utils/alert';
import { clearRecording, getRecording, setRecording } from '../../workout/recordingStore';
import {
  canHandleFiles, deleteLocalFile, downloadToCache, fileInfo, localFileExists, saveToPhotos, shareFile,
} from '../../workout/recordingFiles';

// The end-of-workout recording decision (issue #135 §14-15). Nothing is
// uploaded or saved until the user taps; the local temp file is only removed
// after an explicit confirmation - and, if a private copy was requested, only
// once the server has confirmed it stored the same bytes.
export default function WorkoutRecordingCard({ workoutId, navigation }) {
  const t = useT();
  const [local, setLocal] = useState(null); // { path, frames, fps } while a temp file exists
  const [remote, setRemote] = useState(null); // server status
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [askDeleteLocal, setAskDeleteLocal] = useState(false);
  const [requestedPrivate, setRequestedPrivate] = useState(false);

  const refresh = useCallback(async () => {
    const rec = getRecording(workoutId);
    if (rec?.path && (await localFileExists(rec.path))) setLocal(rec);
    else setLocal(null);
    try {
      setRemote(await fetchWorkoutVideoStatus(workoutId));
    } catch (err) {
      setRemote({ exists: false });
    }
  }, [workoutId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!canHandleFiles || (!local && !(remote && remote.exists))) return null;

  async function run(action) {
    setBusy(true);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setNote(err.code === 'permission_denied' ? t('workout.photosDenied') : err.message || t('workout.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function savePrivately() {
    setRequestedPrivate(true);
    const info = await fileInfo(local.path);
    await uploadWorkoutVideo(workoutId, local.path);
    const result = await completeWorkoutVideo(workoutId, { md5: info.md5 });
    if (!result.verified) throw new Error(t('workout.verifyFailed'));
    if (local.frames?.length) await saveWorkoutPoseSegment(workoutId, { fps: local.fps, frames: local.frames });
    setRemote(result);
    setNote(t('workout.savedPrivately'));
    setAskDeleteLocal(true);
  }

  async function saveToDevice() {
    await saveToPhotos(local.path);
    setNote(t('workout.savedToDevice'));
    setAskDeleteLocal(true);
  }

  function confirmDeleteRecording() {
    showAlert(t('workout.deleteRecording'), t('workout.deleteRecordingBody'), [
      {
        text: t('workout.deleteRecording'),
        style: 'destructive',
        onPress: () => run(async () => {
          if (remote?.exists) await deleteWorkoutVideo(workoutId);
          if (local) await deleteLocalFile(local.path);
          clearRecording(workoutId);
          await refresh();
          setNote(t('workout.recordingDeleted'));
        }),
      },
      { text: t('workout.keep'), style: 'cancel' },
    ]);
  }

  function confirmDeleteLocal() {
    // A private copy that was requested must be verified first.
    if (requestedPrivate && remote?.uploadStatus !== 'verified') {
      setNote(t('workout.waitForVerified'));
      return;
    }
    showAlert(t('workout.deleteLocalTitle'), t('workout.deleteLocalBody'), [
      {
        text: t('workout.deleteLocalCopy'),
        style: 'destructive',
        onPress: () => run(async () => {
          await deleteLocalFile(local.path);
          if (remote?.exists) await markWorkoutVideoLocalDeleted(workoutId).catch(() => {});
          setRecording(workoutId, { path: null });
          setLocal(null);
          setAskDeleteLocal(false);
          setNote(t('workout.localDeleted'));
        }),
      },
      { text: t('workout.keepOnDevice'), style: 'cancel', onPress: () => setAskDeleteLocal(false) },
    ]);
  }

  async function remoteToDevice() {
    const url = await fetchWorkoutVideoUrl(workoutId);
    const file = await downloadToCache(url, `workout-${workoutId}.mp4`);
    try {
      await saveToPhotos(file);
      setNote(t('workout.savedToDevice'));
    } finally {
      await deleteLocalFile(file);
    }
  }

  async function remoteShare() {
    const url = await fetchWorkoutVideoUrl(workoutId);
    const file = await downloadToCache(url, `workout-${workoutId}.mp4`);
    try {
      await shareFile(file);
    } finally {
      await deleteLocalFile(file);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={typography.heading}>{t('workout.recording')}</Text>

      {local && !remote?.exists && (
        <>
          <Text style={typography.body}>{t('workout.recordingQuestion')}</Text>
          <PrimaryButton title={t('workout.savePrivately')} loading={busy} onPress={() => run(savePrivately)} />
          <PrimaryButton variant="secondary" title={t('workout.saveToDevice')} disabled={busy} onPress={() => run(saveToDevice)} />
          <PrimaryButton variant="secondary" title={t('workout.saveBoth')} disabled={busy} onPress={() => run(async () => { await savePrivately(); await saveToDevice(); })} />
          <PrimaryButton variant="secondary" title={t('workout.shareRecording')} disabled={busy} onPress={() => run(() => shareFile(local.path))} />
          <PrimaryButton variant="secondary" title={t('workout.deleteRecording')} disabled={busy} onPress={confirmDeleteRecording} />
        </>
      )}

      {remote?.exists && (
        <>
          <Text style={typography.bodySecondary}>
            {t('workout.storedPrivately', { mb: (remote.sizeBytes / 1048576).toFixed(1) })}
          </Text>
          <PrimaryButton title={t('workout.watch')} onPress={() => navigation.navigate('WorkoutVideo', { workoutId, overlay: false })} />
          <PrimaryButton variant="secondary" title={t('workout.watchOverlay')} onPress={() => navigation.navigate('WorkoutVideo', { workoutId, overlay: true })} />
          <PrimaryButton variant="secondary" title={t('workout.saveToDevice')} disabled={busy} onPress={() => run(remoteToDevice)} />
          <PrimaryButton variant="secondary" title={t('workout.shareRecording')} disabled={busy} onPress={() => run(remoteShare)} />
          <PrimaryButton variant="secondary" title={t('workout.deleteRecording')} disabled={busy} onPress={confirmDeleteRecording} />
        </>
      )}

      {local && askDeleteLocal && (
        <View style={styles.prompt}>
          <Text style={typography.body}>{t('workout.deleteLocalPrompt')}</Text>
          <PrimaryButton title={t('workout.deleteLocalCopy')} disabled={busy} onPress={confirmDeleteLocal} />
          <PrimaryButton variant="secondary" title={t('workout.keepOnDevice')} onPress={() => setAskDeleteLocal(false)} />
        </View>
      )}

      {note && <Text style={typography.bodySecondary}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm, ...cardShadow },
  prompt: { gap: spacing.sm, paddingTop: spacing.sm },
});
