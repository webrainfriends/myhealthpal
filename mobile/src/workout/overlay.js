const { angleDeg } = require('./engine/geometry');

// Pure helpers for the dynamic replay overlay (issue #135 §16): the skeleton
// is drawn from stored sampled landmarks at playback time - no second
// rendered video is ever stored.

const BONES = [
  ['LEFT_SHOULDER', 'RIGHT_SHOULDER'], ['LEFT_HIP', 'RIGHT_HIP'],
  ['LEFT_SHOULDER', 'LEFT_ELBOW'], ['LEFT_ELBOW', 'LEFT_WRIST'],
  ['RIGHT_SHOULDER', 'RIGHT_ELBOW'], ['RIGHT_ELBOW', 'RIGHT_WRIST'],
  ['LEFT_SHOULDER', 'LEFT_HIP'], ['RIGHT_SHOULDER', 'RIGHT_HIP'],
  ['LEFT_HIP', 'LEFT_KNEE'], ['LEFT_KNEE', 'LEFT_ANKLE'],
  ['RIGHT_HIP', 'RIGHT_KNEE'], ['RIGHT_KNEE', 'RIGHT_ANKLE'],
];

// Frames are { t (ms from recording start), lm: { NAME: [x, y] } } sampled at
// `fps`. Returns the frame nearest to `timeMs`, or null when there are none
// or the time is well outside the sampled range.
function frameAt(frames, fps, timeMs) {
  if (!frames || frames.length === 0 || !fps) return null;
  const index = Math.round((timeMs / 1000) * fps);
  if (index < -1 || index > frames.length) return null;
  return frames[Math.max(0, Math.min(frames.length - 1, index))];
}

// Bone segments with both ends present, as [x1, y1, x2, y2] in 0-1 space.
function segments(frame) {
  if (!frame) return [];
  return BONES.filter(([a, b]) => frame.lm[a] && frame.lm[b]).map(([a, b]) => [...frame.lm[a], ...frame.lm[b]]);
}

// Joint angle to label at a joint (e.g. the knee), or null if unavailable.
function jointAngle(frame, [a, b, c]) {
  if (!frame || !frame.lm[a] || !frame.lm[b] || !frame.lm[c]) return null;
  const p = (n) => ({ x: frame.lm[n][0], y: frame.lm[n][1] });
  const value = angleDeg(p(a), p(b), p(c));
  return value == null ? null : Math.round(value);
}

// Form events happening within `windowMs` of the playback time.
function activeEvents(events, timeMs, windowMs = 1500) {
  return (events || []).filter((e) => Math.abs((e.timestampMs ?? -Infinity) - timeMs) <= windowMs);
}

module.exports = { BONES, frameAt, segments, jointAngle, activeEvents };
