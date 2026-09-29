const test = require('node:test');
const assert = require('node:assert/strict');
const hr = require('../src/workout/heartRate');
const { estimateCalories, METHOD_VERSION, METHOD_VERSION_HR } = require('../src/workout/calorieEstimator');

const T0 = Date.parse('2026-09-29T10:00:00Z');
const sample = (sec, bpm) => ({ t: new Date(T0 + sec * 1000).toISOString(), bpm });

test('cleanSamples drops implausible values, sorts, and bounds the series', () => {
  const cleaned = hr.cleanSamples([sample(10, 120), sample(0, 100), sample(5, 5), sample(6, 400), { t: 'nope', bpm: 100 }, null]);
  assert.deepEqual(cleaned.map((s) => s.bpm), [100, 120]);
  const many = hr.cleanSamples(Array.from({ length: 5000 }, (_, i) => sample(i, 100 + (i % 30))));
  assert.equal(many.length, 300);
  assert.deepEqual(hr.cleanSamples('x'), []);
});

test('summarize reports avg/max/min and null when empty', () => {
  const s = hr.summarize(hr.cleanSamples([sample(0, 100), sample(10, 140), sample(20, 120)]));
  assert.deepEqual(s, { avgBpm: 120, maxBpm: 140, minBpm: 100, sampleCount: 3 });
  assert.equal(hr.summarize([]), null);
});

test('zoneTimeRatio is time-weighted and null without a zone or data', () => {
  const samples = hr.cleanSamples([sample(0, 100), sample(30, 130), sample(60, 130), sample(90, 100)]);
  // 0-30s at 100 (out), 30-90s at 130 (in), last reading holds 5s at 100 (out)
  const r = hr.zoneTimeRatio(samples, 120, 150);
  assert.ok(r > 0.6 && r < 0.7, String(r));
  assert.equal(hr.zoneTimeRatio(samples, null, null), null);
  assert.equal(hr.zoneTimeRatio([], 100, 150), null);
});

test('calories v2: device energy > heart rate > MET, each recorded with its inputs', () => {
  const base = { metValue: 5, weightKg: 80, activeSeconds: 1800 };
  const met = estimateCalories(base);
  assert.equal(met.methodVersion, METHOD_VERSION);

  const high = estimateCalories({ ...base, heartRate: { avgBpm: 150, sampleCount: 20 } });
  assert.equal(high.methodVersion, METHOD_VERSION_HR);
  assert.ok(high.inputs.sources.includes('heart rate'));
  assert.ok((high.low + high.high) / 2 > (met.low + met.high) / 2, 'higher HR raises the estimate');
  assert.ok(high.inputs.hrScale <= 1.25);
  assert.equal(high.confidence, 'high');

  const low = estimateCalories({ ...base, heartRate: { avgBpm: 70, sampleCount: 20 } });
  assert.ok(low.inputs.hrScale >= 0.75);

  const sparse = estimateCalories({ ...base, heartRate: { avgBpm: 150, sampleCount: 1 } });
  assert.equal(sparse.methodVersion, METHOD_VERSION); // too few samples to trust

  const device = estimateCalories({ ...base, heartRate: { avgBpm: 150, sampleCount: 20 }, deviceActiveKcal: 200 });
  assert.equal(device.confidence, 'high');
  assert.deepEqual([device.low, device.high], [180, 220]);
  assert.ok(device.inputs.sources.includes('device active energy'));
});
