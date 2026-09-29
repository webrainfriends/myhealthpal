const { angleDeg, inclinationFromVertical } = require('./geometry');

const SIDES = ['LEFT', 'RIGHT'];
const fill = (name, side) => name.replace('{S}', side);

// Evaluates a measure ({type:'angle'|'inclination', ...}) on the given side.
// Returns { value, confidence } or null when a joint is missing.
function measureSide(measure, lm, side, minConfidence) {
  const names = measure.type === 'angle' ? measure.joints : [measure.from, measure.to];
  const pts = names.map((n) => lm[fill(n, side)]);
  if (pts.some((p) => !p || p.c < minConfidence)) return null;
  const value = measure.type === 'angle' ? angleDeg(pts[0], pts[1], pts[2]) : inclinationFromVertical(pts[0], pts[1]);
  if (value == null) return null;
  return { value, confidence: Math.min(...pts.map((p) => p.c)), side: side.toLowerCase() };
}

// combine: 'avg' | 'min' over the visible sides.
function measureBody(measure, lm, minConfidence, combine = 'avg') {
  const results = SIDES.map((s) => measureSide(measure, lm, s, minConfidence)).filter(Boolean);
  if (results.length === 0) return null;
  const values = results.map((r) => r.value);
  const value = combine === 'min' ? Math.min(...values) : values.reduce((a, b) => a + b, 0) / values.length;
  return { value, confidence: Math.min(...results.map((r) => r.confidence)), sides: results.map((r) => r.side), results };
}

// Which required landmarks are not visible enough (camera-setup gate).
function missingLandmarks(lm, required, minConfidence) {
  const missing = [];
  for (const name of required) {
    const base = name.replace(/^(LEFT|RIGHT)_/, '');
    // Either side satisfies a requirement so side-on framing works.
    const ok = SIDES.some((s) => lm[`${s}_${base}`] && lm[`${s}_${base}`].c >= minConfidence);
    if (!ok) missing.push(base);
  }
  return [...new Set(missing)];
}

module.exports = { measureBody, measureSide, missingLandmarks };
