import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { MediapipeCamera, RunningMode, usePoseDetection } from 'react-native-mediapipe';
import { toLandmarkMap } from '../landmarks';

// Live camera + on-device pose landmarker. Frames are analysed at a sampled
// rate on the device; nothing is recorded or uploaded. The .task model file
// must be bundled with the native app (see docs in the PR).
const MODEL = 'pose_landmarker_lite.task';
const TARGET_FPS = 15;

export default function PoseCamera({ onLandmarks, onError, camera = 'front', style }) {
  const handleResults = useCallback(
    (bundle) => {
      const first = bundle?.results?.[0]?.landmarks?.[0];
      onLandmarks(first ? toLandmarkMap(first) : {});
    },
    [onLandmarks]
  );
  const handleError = useCallback((e) => onError?.(e), [onError]);

  const solution = usePoseDetection(
    { onResults: handleResults, onError: handleError },
    RunningMode.LIVE_STREAM,
    MODEL,
    { numPoses: 1, fpsMode: TARGET_FPS, shouldOutputSegmentationMasks: false }
  );

  return <MediapipeCamera style={[styles.camera, style]} solution={solution} activeCamera={camera} />;
}

const styles = StyleSheet.create({ camera: { flex: 1 } });
