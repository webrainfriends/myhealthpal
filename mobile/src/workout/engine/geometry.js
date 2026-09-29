// Pure landmark geometry for the Workout Coach. Landmarks are a map of
// name -> { x, y, c } (normalized image coordinates, c = confidence 0-1),
// produced by the pose plugin adapter (see hooks/usePoseTracker.js).
// Dependency-free so the whole engine is unit-testable under node --test.

function angleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m === 0) return null;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

// Angle of the segment a->b from vertical, 0 = perfectly upright.
function inclinationFromVertical(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, c: Math.min(a.c, b.c) });

// Exponential moving average; alpha 1 = no smoothing.
function ema(prev, next, alpha) {
  return prev == null ? next : prev + alpha * (next - prev);
}

module.exports = { angleDeg, inclinationFromVertical, midpoint, ema };
