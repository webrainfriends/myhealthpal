// Heart-rate handling for workout sessions (issue #135 Phase 4). Pure
// functions: clean incoming samples, summarise them, and measure time spent
// in a target zone.

const MAX_SAMPLES = 300;
const MAX_HOLD_MS = 60 * 1000; // a reading is assumed to hold for at most this long

// Accepts [{ t (ISO string or epoch ms), bpm }], drops implausible values,
// sorts by time and downsamples to a bounded, evenly spaced series.
function cleanSamples(samples) {
  if (!Array.isArray(samples)) return [];
  const rows = [];
  for (const s of samples.slice(0, 20000)) {
    const t = typeof s?.t === 'number' ? s.t : Date.parse(s?.t);
    const bpm = Number(s?.bpm);
    if (Number.isFinite(t) && Number.isFinite(bpm) && bpm >= 30 && bpm <= 230) rows.push({ t, bpm: Math.round(bpm) });
  }
  rows.sort((a, b) => a.t - b.t);
  if (rows.length <= MAX_SAMPLES) return rows;
  const step = rows.length / MAX_SAMPLES;
  return Array.from({ length: MAX_SAMPLES }, (_, i) => rows[Math.floor(i * step)]);
}

function summarize(samples) {
  if (!samples.length) return null;
  const bpms = samples.map((s) => s.bpm);
  return {
    avgBpm: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
    maxBpm: Math.max(...bpms),
    minBpm: Math.min(...bpms),
    sampleCount: samples.length,
  };
}

// Fraction (0-1) of measured time within [low, high]; each reading covers the
// time until the next one (capped), the last one a short fixed span. Null
// when there is no zone or no data.
function zoneTimeRatio(samples, low, high) {
  if (!samples.length || low == null || high == null) return null;
  let total = 0;
  let inZone = 0;
  samples.forEach((s, i) => {
    const next = samples[i + 1];
    const span = Math.min(next ? next.t - s.t : 5000, MAX_HOLD_MS);
    if (span <= 0) return;
    total += span;
    if (s.bpm >= low && s.bpm <= high) inZone += span;
  });
  return total > 0 ? Number((inZone / total).toFixed(3)) : null;
}

module.exports = { cleanSamples, summarize, zoneTimeRatio };
