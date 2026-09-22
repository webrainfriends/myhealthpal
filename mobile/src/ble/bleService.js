import { Platform, PermissionsAndroid } from 'react-native';
import { profileForDeviceType, allScannableServiceUuids } from './deviceProfiles';
import { RACP_OPCODE_REPORT_STORED_RECORDS, RACP_OPERATOR_ALL_RECORDS, CHARACTERISTICS } from './gattConstants';
import { bytesToBase64 } from './parsers';

// react-native-ble-plx requires a custom dev client build (it's a native
// module - Expo Go cannot load it). Rather than make every screen that
// imports this file crash under Expo Go, the native module is loaded
// lazily and every export below degrades to a clear "Bluetooth isn't
// available in this build" error instead of a module-not-found crash.
let BleManagerClass = null;
let bleManager = null;
function getManager() {
  if (bleManager) return bleManager;
  try {
    // eslint-disable-next-line global-require
    BleManagerClass = require('react-native-ble-plx').BleManager;
  } catch (err) {
    return null;
  }
  bleManager = new BleManagerClass();
  return bleManager;
}

export function isBleAvailable() {
  return getManager() !== null;
}

// Android 12+ (API 31+) replaced the old "Bluetooth needs location"
// permission model with BLUETOOTH_SCAN/BLUETOOTH_CONNECT - both are
// requested, plus the older ACCESS_FINE_LOCATION for pre-12 devices where
// BLE scan results are otherwise silently empty. iOS has no equivalent
// runtime request here: the NSBluetooth*UsageDescription strings in
// app.json are enough, and the system prompt appears the first time the
// manager is used.
export async function requestBlePermissions() {
  if (Platform.OS !== 'android') return true;

  const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (Platform.Version >= 31) {
    permissions.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    );
  }

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
}

// Scans for peripherals advertising any of the GATT services this app
// knows how to read (see deviceProfiles.allScannableServiceUuids) and
// reports each one exactly once via onDeviceFound, for `timeoutMs`
// (default 15s - long enough to catch a device that's slow to start
// advertising after being switched on, short enough not to drain the
// phone's battery if the screen is left open). Returns a stop() function
// the caller can invoke early (e.g. the person tapped a result already).
export function scanForDevices(onDeviceFound, { timeoutMs = 15000 } = {}) {
  const manager = getManager();
  if (!manager) throw new Error('Bluetooth is not available in this build.');

  const seen = new Set();
  manager.startDeviceScan(allScannableServiceUuids(), { allowDuplicates: false }, (error, device) => {
    if (error) {
      onDeviceFound(null, error);
      return;
    }
    if (!device || seen.has(device.id)) return;
    seen.add(device.id);
    onDeviceFound(device, null);
  });

  const timer = setTimeout(() => manager.stopDeviceScan(), timeoutMs);
  return () => {
    clearTimeout(timer);
    manager.stopDeviceScan();
  };
}

// A glucose meter never pushes readings on its own - it only reports its
// stored history when explicitly asked, by writing "report stored records
// > all records" to the Record Access Control Point characteristic. The
// meter then streams each record as a Measurement notification, so the
// caller must already be subscribed before this write goes out.
async function requestStoredRecords(device, serviceUuid) {
  const payload = bytesToBase64([RACP_OPCODE_REPORT_STORED_RECORDS, RACP_OPERATOR_ALL_RECORDS]);
  await device.writeCharacteristicWithResponseForService(
    serviceUuid,
    CHARACTERISTICS.RECORD_ACCESS_CONTROL_POINT,
    payload
  );
}

// Connects to one already-paired device, collects every reading it sends
// within the sync window, and disconnects - the full "sync now" flow. Each
// resolved reading is already in the shape POST /api/devices/:id/readings
// expects (see deviceService.buildReadingRow on the server).
//
// A BLE peripheral only exposes one live notification stream per
// characteristic, so multi-record devices (chiefly glucose meters, which
// can hold hundreds of stored readings) are collected by listening across
// the whole `collectWindowMs` rather than resolving on the first
// notification - a single-record device (a BP monitor or scale mid-
// measurement) will simply stop sending after its one reading and the
// caller doesn't wait out the full window needlessly.
export async function connectAndSync(bluetoothId, deviceType, { collectWindowMs = 4000, miScale = false } = {}) {
  const manager = getManager();
  if (!manager) throw new Error('Bluetooth is not available in this build.');

  const profile = profileForDeviceType(deviceType, { preferMiScale: miScale });
  if (!profile) throw new Error(`No Bluetooth profile for device type: ${deviceType}`);

  let device = await manager.connectToDevice(bluetoothId, { timeout: 10000 });
  device = await device.discoverAllServicesAndCharacteristics();

  const readings = [];
  const subscription = device.monitorCharacteristicForService(
    profile.serviceUuid,
    profile.measurementCharacteristicUuid,
    (error, characteristic) => {
      if (error || !characteristic?.value) return;
      const reading = profile.parse(characteristic.value);
      if (reading) readings.push(reading);
    }
  );

  try {
    if (profile.requiresRacp) {
      await requestStoredRecords(device, profile.serviceUuid);
    }
    await new Promise((resolve) => setTimeout(resolve, collectWindowMs));
  } finally {
    subscription.remove();
    await device.cancelConnection().catch(() => {});
  }

  return readings;
}

// Exported for screens that need to know a scan/connect attempt failed
// because the person hasn't turned Bluetooth on yet, vs. any other error -
// used to show "Turn on Bluetooth" instead of a generic failure message.
export async function isBluetoothPoweredOn() {
  const manager = getManager();
  if (!manager) return false;
  const state = await manager.state();
  return state === 'PoweredOn';
}
