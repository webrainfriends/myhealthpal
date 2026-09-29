import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radii, spacing, typography } from '../../theme/theme';
import { fetchWorkoutPoseSegment, fetchWorkoutVideoUrl } from '../../api/client';
import { useT } from '../../i18n/I18nContext';
import { activeEvents, frameAt, jointAngle, segments } from '../../workout/overlay';

const ASPECT = 9 / 16; // portrait recordings

// Plays a retained recording from a short-lived signed URL. With overlay on,
// the skeleton, a joint angle and form-warning markers are drawn from the
// stored landmark samples at the current playback time.
export default function WorkoutVideoScreen({ route }) {
  const t = useT();
  const { workoutId, overlay } = route.params;
  const [url, setUrl] = useState(null);
  const [pose, setPose] = useState(null);
  const [error, setError] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let alive = true;
    fetchWorkoutVideoUrl(workoutId).then((u) => alive && setUrl(u)).catch(() => alive && setError(true));
    if (overlay) fetchWorkoutPoseSegment(workoutId).then((p) => alive && setPose(p)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [workoutId, overlay]);

  const player = useVideoPlayer(url ? { uri: url } : null, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    if (!overlay || !player) return undefined;
    const id = setInterval(() => setTimeMs(Math.round((player.currentTime || 0) * 1000)), 100);
    return () => clearInterval(id);
  }, [overlay, player]);

  const frame = useMemo(() => (pose ? frameAt(pose.frames, pose.fps, timeMs) : null), [pose, timeMs]);
  const warnings = pose ? activeEvents(pose.events, timeMs) : [];
  const knee = frame && (jointAngle(frame, ['LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE']) ?? jointAngle(frame, ['RIGHT_HIP', 'RIGHT_KNEE', 'RIGHT_ANKLE']));

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.light}>{t('workout.recordingUnavailable')}</Text>
      </SafeAreaView>
    );
  }
  if (!url) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.onBrand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stage} onLayout={(e) => setSize(e.nativeEvent.layout)}>
        <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
        {overlay && frame && size.width > 0 && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            {segments(frame).map(([x1, y1, x2, y2], i) => (
              <Line key={i} x1={x1 * size.width} y1={y1 * size.height} x2={x2 * size.width} y2={y2 * size.height} stroke={colors.success} strokeWidth={3} />
            ))}
            {Object.values(frame.lm).map(([x, y], i) => (
              <Circle key={i} cx={x * size.width} cy={y * size.height} r={5} fill={colors.onBrand} />
            ))}
          </Svg>
        )}
      </View>
      {overlay && (
        <View style={styles.info}>
          {knee != null && <Text style={styles.light}>{t('workout.jointAngle', { angle: knee })}</Text>}
          {warnings.map((w, i) => (
            <Text key={i} style={styles.warn}>⚠ {w.message || w.ruleCode}</Text>
          ))}
          {pose && pose.frames.length === 0 && <Text style={styles.light}>{t('workout.noOverlayData')}</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  stage: { width: '100%', aspectRatio: ASPECT, maxHeight: '80%', alignSelf: 'center', backgroundColor: '#000' },
  info: { padding: spacing.md, gap: spacing.sm },
  light: { ...typography.body, color: colors.onBrand, textAlign: 'center' },
  warn: { ...typography.body, color: colors.warning, fontWeight: '700', textAlign: 'center', borderRadius: radii.md },
});
