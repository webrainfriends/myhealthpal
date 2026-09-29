import { Platform } from 'react-native';

// Apple Watch and Samsung Galaxy Watch step counts never reach this app
// over a direct Bluetooth connection the way a glucose meter or BP monitor
// does - a phone app cannot open its own BLE link to a watch that's
// already paired to the OS's own companion app. Instead, both platforms
// funnel that data through one phone-wide health data store (HealthKit on
// iOS, Health Connect on Android), which is what this module reads from.
// Both native modules require a custom dev client (react-native-health for
// HealthKit, react-native-health-connect for Health Connect) - the same
// constraint mobile/src/ble/bleService.js has, and handled the same way:
// lazy-loaded, degrading to isAvailable() === false rather than crashing
// when the module isn't linked into this build.

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

export function stepSourceForPlatform() {
  if (Platform.OS === 'ios') return 'apple_health';
  if (Platform.OS === 'android') return 'health_connect';
  return null;
}

export function isStepSyncAvailable() {
  if (Platform.OS === 'ios') return getHealthKit() !== null;
  if (Platform.OS === 'android') return getHealthConnect() !== null;
  return false;
}

function requestHealthKitAuthorization(hk) {
  return new Promise((resolve, reject) => {
    hk.initHealthKit({ permissions: { read: ['StepCount'], write: [] } }, (err) => {
      if (err) reject(new Error(err));
      else resolve();
    });
  });
}

// Returns one entry per calendar day in [since, now] as
// { date: 'YYYY-MM-DD', steps }, ready to POST one-by-one to /api/activity
// (see mobile/src/api/client.js's logActivity) - the same shape and
// endpoint the wearable-export upload path already feeds (see
// activityImportService.js on the server), so a HealthKit/Health Connect
// sync and a MedM-style file upload both land in the same activity_logs
// history with no separate code path on the server at all.
async function fetchAppleHealthDailySteps(since) {
  const hk = getHealthKit();
  if (!hk) throw new Error('HealthKit is not available in this build.');
  await requestHealthKitAuthorization(hk);

  return new Promise((resolve, reject) => {
    hk.getDailyStepCountSamples(
      { startDate: since.toISOString(), endDate: new Date().toISOString() },
      (err, results) => {
        if (err) {
          reject(new Error(err));
          return;
        }
        const byDay = new Map();
        for (const sample of results || []) {
          const day = sample.startDate.slice(0, 10);
          byDay.set(day, (byDay.get(day) || 0) + Math.round(sample.value));
        }
        resolve([...byDay.entries()].map(([date, steps]) => ({ date, steps })));
      }
    );
  });
}

async function fetchHealthConnectDailySteps(since) {
  const hc = getHealthConnect();
  if (!hc) throw new Error('Health Connect is not available in this build.');

  const initialized = await hc.initialize();
  if (!initialized) throw new Error('Health Connect is not installed on this device.');
  await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);

  const { records } = await hc.readRecords('Steps', {
    timeRangeFilter: { operator: 'between', startTime: since.toISOString(), endTime: new Date().toISOString() },
  });

  const byDay = new Map();
  for (const record of records || []) {
    const day = record.startTime.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + Math.round(record.count));
  }
  return [...byDay.entries()].map(([date, steps]) => ({ date, steps }));
}

// `since` defaults to 7 days back - matches the dashboard's own activity
// window (see DashboardScreen's fetchActivitySummary(7) call) rather than
// re-importing the platform's full history on every sync.
export async function fetchDailyStepsSince(since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
  if (Platform.OS === 'ios') return fetchAppleHealthDailySteps(since);
  if (Platform.OS === 'android') return fetchHealthConnectDailySteps(since);
  throw new Error('Step sync is only available on iOS and Android.');
}
