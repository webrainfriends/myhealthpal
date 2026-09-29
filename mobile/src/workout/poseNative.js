// The only place that touches the camera/pose native modules. Both need the
// custom dev client (same constraint as ble/bleService.js and
// health/stepSync.js), so they are lazy-required and everything degrades to
// isPoseTrackingAvailable() === false rather than crashing when the build
// doesn't include them (Expo Go, web).

let camera = null;
function getVisionCamera() {
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
  return !!getVisionCamera() && !!getPoseCameraComponent();
}

export async function getCameraPermission() {
  const vc = getVisionCamera();
  if (!vc) return 'unavailable';
  const status = await vc.Camera.getCameraPermissionStatus();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'not-determined';
}

// Only called when the user taps "Allow camera" - never on app start.
export async function requestCameraPermission() {
  const vc = getVisionCamera();
  if (!vc) return 'unavailable';
  const status = await vc.Camera.requestCameraPermission();
  return status === 'granted' ? 'granted' : 'denied';
}
