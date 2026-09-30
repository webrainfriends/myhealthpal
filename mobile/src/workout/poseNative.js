// The only place that touches the camera/pose native modules. Both need the
// custom dev client (same constraint as ble/bleService.js and
// health/stepSync.js), so they are lazy-required and everything degrades to
// isPoseTrackingAvailable() === false rather than crashing when the build
// doesn't include them (Expo Go, web).

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// Browser camera access needs a secure context (https or localhost) and the
// MediaDevices API - the plain http://...:5250 address cannot use the camera.
function webCameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window !== 'undefined' && window.isSecureContext;
}

let camera = null;
function getVisionCamera() {
  if (isWeb) return null; // the browser uses components/PoseCamera.web.jsx instead
  if (camera) return camera;
  try {
    // eslint-disable-next-line global-require
    camera = require('react-native-vision-camera');
  } catch (err) {
    return null;
  }
  return camera;
}

let poseCameraComponent = null;
export function getPoseCameraComponent() {
  if (poseCameraComponent) return poseCameraComponent;
  try {
    // PoseCamera imports react-native-mediapipe, which throws at import time
    // when its native module isn't linked.
    // eslint-disable-next-line global-require
    poseCameraComponent = require('./components/PoseCamera').default;
  } catch (err) {
    return null;
  }
  return poseCameraComponent;
}

export function isPoseTrackingAvailable() {
  if (isWeb) return webCameraSupported() && !!getPoseCameraComponent();
  return !!getVisionCamera() && !!getPoseCameraComponent();
}

// Why tracking is unavailable, so the screen can say something useful.
export function poseUnavailableReason() {
  if (isPoseTrackingAvailable()) return null;
  if (isWeb) return webCameraSupported() ? 'web_component' : 'insecure_context';
  return 'native_build';
}

export async function getCameraPermission() {
  if (isWeb) {
    try {
      const status = await navigator.permissions?.query({ name: 'camera' });
      if (status?.state === 'granted') return 'granted';
      if (status?.state === 'denied') return 'denied';
    } catch (err) {
      // Safari can't query the camera permission - fall through.
    }
    return webCameraSupported() ? 'not-determined' : 'unavailable';
  }
  const vc = getVisionCamera();
  if (!vc) return 'unavailable';
  const status = await vc.Camera.getCameraPermissionStatus();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'not-determined';
}

// Only called when the user taps "Allow camera" - never on app start.
export async function requestCameraPermission() {
  if (isWeb) {
    if (!webCameraSupported()) return 'unavailable';
    try {
      // Opens the camera once to trigger the browser prompt, then releases it.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    } catch (err) {
      return 'denied';
    }
  }
  const vc = getVisionCamera();
  if (!vc) return 'unavailable';
  const status = await vc.Camera.requestCameraPermission();
  return status === 'granted' ? 'granted' : 'denied';
}
