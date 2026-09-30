import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { toLandmarkMap } from '../landmarks';

// Browser version of PoseCamera (Metro picks *.web.jsx on web): the camera
// comes from getUserMedia and pose estimation is MediaPipe's PoseLandmarker
// running in this tab via WebAssembly - the video never leaves the device.
// The engine, runner and screens are identical to the native path: this just
// turns frames into the same { NAME: { x, y, c } } landmark maps.
//
// The WASM engine and the model are served from this site itself (see
// mobile/scripts/prepare-web-pose-assets.js) rather than a third-party CDN.
const WASM_BASE = '/mediapipe/wasm';
const MODEL_URL = '/mediapipe/pose_landmarker_lite.task';
const FRAME_INTERVAL_MS = 1000 / 15; // sampled rate, like the native path

async function createLandmarker() {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    // Some browsers/devices (notably iOS Safari) can't run the GPU delegate.
    return PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

const PoseCamera = forwardRef(function PoseCamera({ onLandmarks, onError, camera = 'front', style }, ref) {
  const videoRef = useRef(null);
  const callbacks = useRef({ onLandmarks, onError });
  callbacks.current = { onLandmarks, onError };

  // Recording is native-only for now: resolve with no file so the caller
  // simply has nothing to save.
  useImperativeHandle(ref, () => ({
    startRecording: () => Promise.resolve(null),
    stopRecording: () => Promise.resolve(),
  }));

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let landmarker = null;
    let raf = null;
    let lastRun = 0;
    let lastVideoTime = -1;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: camera === 'front' ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        landmarker = await createLandmarker();
        if (stopped) return;

        const tick = () => {
          if (stopped) return;
          raf = requestAnimationFrame(tick);
          const now = performance.now();
          if (now - lastRun < FRAME_INTERVAL_MS || video.readyState < 2 || video.currentTime === lastVideoTime) return;
          lastRun = now;
          lastVideoTime = video.currentTime;
          try {
            const result = landmarker.detectForVideo(video, now);
            const first = result?.landmarks?.[0];
            callbacks.current.onLandmarks(first ? toLandmarkMap(first) : {});
          } catch (err) {
            callbacks.current.onError?.(err);
          }
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (!stopped) callbacks.current.onError?.(err);
      }
    }
    start();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (landmarker) landmarker.close();
    };
  }, [camera]);

  return (
    <View style={[styles.container, style]}>
      {/* Mirrored like a selfie view; landmarks are computed on the unmirrored frame. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: camera === 'front' ? 'scaleX(-1)' : 'none', backgroundColor: '#000' }}
      />
    </View>
  );
});

export default PoseCamera;

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#000', overflow: 'hidden' } });
