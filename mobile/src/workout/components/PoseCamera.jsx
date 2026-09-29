import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { RunningMode, usePoseDetection } from 'react-native-mediapipe';
import { toLandmarkMap } from '../landmarks';

// Live camera + on-device pose landmarker. Frames are analysed at a sampled
// rate on the device. Recording is opt-in: the parent calls startRecording()
// only when the user chose to record, and the file stays a local temp file
// until the user decides what to do with it (nothing is uploaded here).
// The .task model file must be bundled with the native app (see the PR).
const MODEL = 'pose_landmarker_lite.task';
const TARGET_FPS = 15;

const PoseCamera = forwardRef(function PoseCamera({ onLandmarks, onError, camera = 'front', style }, ref) {
  const cameraRef = useRef(null);
  const device = useCameraDevice(camera);
  // 720p keeps recordings small; capture/inference resolution is independent
  // of the saved video (issue #135 performance notes).
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }, { fps: 30 }]);

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
  const {
    cameraDeviceChangeHandler, cameraViewLayoutChangeHandler, cameraOrientationChangedHandler, resizeModeChangeHandler, frameProcessor,
  } = solution;

  // Same wiring MediapipeCamera does: tell the pose solution which camera
  // device and resize mode are in use so landmark coordinates map correctly.
  useEffect(() => {
    if (device) cameraDeviceChangeHandler(device);
  }, [device, cameraDeviceChangeHandler]);
  useEffect(() => {
    resizeModeChangeHandler('cover');
  }, [resizeModeChangeHandler]);

  useImperativeHandle(ref, () => ({
    // Resolves with the recorded file path once stopped.
    startRecording() {
      return new Promise((resolve, reject) => {
        if (!cameraRef.current) return reject(new Error('Camera not ready'));
        cameraRef.current.startRecording({
          fileType: 'mp4',
          videoBitrate: 'low',
          onRecordingFinished: (video) => resolve(video.path.startsWith('file://') ? video.path : `file://${video.path}`),
          onRecordingError: reject,
        });
        return undefined;
      });
    },
    async stopRecording() {
      await cameraRef.current?.stopRecording();
    },
  }));

  if (!device) return null;
  return (
    <Camera
      ref={cameraRef}
      style={[styles.camera, style]}
      device={device}
      format={format}
      resizeMode="cover"
      pixelFormat="rgb"
      isActive
      video
      audio={false}
      frameProcessor={frameProcessor}
      onLayout={cameraViewLayoutChangeHandler}
      onOutputOrientationChanged={cameraOrientationChangedHandler}
    />
  );
});

export default PoseCamera;

const styles = StyleSheet.create({ camera: { flex: 1 } });
