// Minimal in-process security metrics: counts and latencies only, never
// content. Exposed for logging/ops (e.g. a periodic summary line) without
// pulling in a metrics dependency.
const counters = {};
const timings = {};

function increment(name, by = 1) {
  counters[name] = (counters[name] || 0) + by;
}

function record(name, ms) {
  const t = timings[name] || { count: 0, totalMs: 0, maxMs: 0 };
  t.count += 1;
  t.totalMs += ms;
  t.maxMs = Math.max(t.maxMs, ms);
  timings[name] = t;
}

function snapshot() {
  return { counters: { ...counters }, timings: JSON.parse(JSON.stringify(timings)) };
}

module.exports = { increment, record, snapshot };
