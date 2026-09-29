// MediaPipe pose landmark indices -> the named joints the engine uses.
const NAMES = {
  11: 'LEFT_SHOULDER', 12: 'RIGHT_SHOULDER', 13: 'LEFT_ELBOW', 14: 'RIGHT_ELBOW',
  15: 'LEFT_WRIST', 16: 'RIGHT_WRIST', 23: 'LEFT_HIP', 24: 'RIGHT_HIP',
  25: 'LEFT_KNEE', 26: 'RIGHT_KNEE', 27: 'LEFT_ANKLE', 28: 'RIGHT_ANKLE',
  31: 'LEFT_FOOT_INDEX', 32: 'RIGHT_FOOT_INDEX',
};

// Only the joints we need are kept (issue #135: process necessary
// landmarks only). Confidence uses the landmark's visibility score.
export function toLandmarkMap(landmarks) {
  const map = {};
  for (const [index, name] of Object.entries(NAMES)) {
    const p = landmarks[index];
    if (p) map[name] = { x: p.x, y: p.y, c: p.visibility ?? p.presence ?? 1 };
  }
  return map;
}
