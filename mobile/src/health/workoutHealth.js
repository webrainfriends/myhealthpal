import { Platform } from 'react-native';

// Heart rate and active energy for a workout window (issue #135 Phase 4),
// read from the phone's health store: HealthKit on iOS, Health Connect on
// Android (Samsung Health writes to Health Connect, so it needs no SDK of
// its own). Same approach as stepSync.js: native modules are lazy-loaded and
// everything degrades to "not available" in Expo Go / on the web. Permission
// is requested only when the user turns the option on.

let healthKit = null;
function getHealthKit() {
  if (Platform.OS !== 'ios') return null;
  if (healthKit) return healthKit;
  try {
    // eslint-disable-next-line global-require
    healthKit = require('react-native-health').default;
  } catch (err) {
    return null;
  }
  return healthKit;
}

let healthConnect = null;
function getHealthConnect() {
  if (Platform.OS !== 'android') return null;
  if (healthConnect) return healthConnect;
  try {
    // eslint-disable-next-line global-require
    healthConnect = require('react-native-health-connect');
  } catch (err) {
    return null;
  }
  return healthConnect;
}

export function isWorkoutHealthAvailable() {
  return getHealthKit() !== null || getHealthConnect() !== null;
}

export function workoutHealthSource() {
  return Platform.OS === 'ios' ? 'apple_health' : 'health_connect';
}

const cb = (fn) => new Promise((resolve, reject) => fn((err, res) => (err ? reject(new Error(String(err))) : resolve(res))));

// Asks for read access to heart rate + active energy. Resolves true if the
// store is usable (the OS never reveals whether read access was granted, so
// an empty result later is handled as "no data").
export async function requestWorkoutHealthAccess() {
  const hk = getHealthKit();
  if (hk) {
    await cb((done) => hk.initHealthKit({ permissions: { read: ['HeartRate', 'ActiveEnergyBurned'], write: [] } }, done));
    return true;
  }
  const hc = getHealthConnect();
  if (hc) {
    const ok = await hc.initialize();
    if (!ok) throw new Error('Health Connect is not installed on this device.');
    await hc.requestPermission([
      { accessType: 'read', recordType: 'HeartRate' },
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
    ]);
    return true;
  }
  throw new Error('Health data is not available in this build.');
}

// Returns { source, samples: [{ t: ISO, bpm }], activeKcal: number|null } for
// [start, end]. Never throws for "no data" - only for a broken store.
export async function fetchWorkoutHealth(start, end) {
  const range = { startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString() };
  const hk = getHealthKit();
  if (hk) {
    const hrRows = await cb((done) => hk.getHeartRateSamples({ ...range, ascending: true }, done)).catch(() => []);
    const energyRows = await cb((done) => hk.getActiveEnergyBurned(range, done)).catch(() => []);
    return {
      source: 'apple_health',
      samples: (hrRows || []).map((r) => ({ t: r.startDate, bpm: r.value })),
      activeKcal: (energyRows || []).reduce((sum, r) => sum + (Number(r.value) || 0), 0) || null,
    };
  }
  const hc = getHealthConnect();
  if (hc) {
    const timeRangeFilter = { operator: 'between', startTime: range.startDate, endTime: range.endDate };
    const hr = await hc.readRecords('HeartRate', { timeRangeFilter }).catch(() => ({ records: [] }));
    const energy = await hc.readRecords('ActiveCaloriesBurned', { timeRangeFilter }).catch(() => ({ records: [] }));
    const samples = [];
    for (const rec of hr.records || []) for (const s of rec.samples || []) samples.push({ t: s.time, bpm: s.beatsPerMinute });
    return {
      source: 'health_connect',
      samples,
      activeKcal: (energy.records || []).reduce((sum, r) => sum + (Number(r.energy?.inKilocalories) || 0), 0) || null,
    };
  }
  return { source: null, samples: [], activeKcal: null };
}
