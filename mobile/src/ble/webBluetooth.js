import { profileForDeviceType, DEVICE_PROFILES, MI_SCALE_PROFILE } from './deviceProfiles';
import { RACP_OPCODE_REPORT_STORED_RECORDS, RACP_OPERATOR_ALL_RECORDS, CHARACTERISTICS } from './gattConstants';
import { bytesToBase64 } from './parsers';

// Web Bluetooth counterpart to bleService.js's react-native-ble-plx path,
// for desktop/Android Chrome and Edge. Safari (iOS/iPadOS/macOS) and
// Firefox don't implement navigator.bluetooth, so isWebBluetoothSupported()
// is false there and callers show a "use another browser / the app" message.
//
// Differences from native that shape this file:
//  - No background scanning: requestDevice() must be called from a user
//    gesture and shows the browser's own chooser, so "scan" and "pair" are
//    one step.
//  - Reconnecting by saved id only works via navigator.bluetooth.getDevices()
//    (Chrome, permissions-backend flag or newer versions). When it isn't
//    there, sync falls back to showing the chooser again.

export function isWebBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';
}

// Devices chosen this session, so "Sync now" right after pairing doesn't
// need a second chooser.
const knownDevices = new Map();

function base64FromDataView(view) {
  return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

export async function requestWebDevice(deviceType) {
  if (!isWebBluetoothSupported()) throw new Error('This browser doesn’t support Web Bluetooth. Try Chrome or Edge on Android or desktop.');
  const profile = DEVICE_PROFILES[deviceType];
  if (!profile) throw new Error(`No Bluetooth profile for device type: ${deviceType}`);

  const filters = [{ services: [profile.serviceUuid] }];
  const optionalServices = [profile.serviceUuid];
  if (deviceType === 'smart_scale') {
    // Mi Scale 2 advertises a proprietary service instead of the standard one.
    filters.push({ services: [MI_SCALE_PROFILE.serviceUuid] });
    optionalServices.push(MI_SCALE_PROFILE.serviceUuid);
  }

  const device = await navigator.bluetooth.requestDevice({ filters, optionalServices });
  knownDevices.set(device.id, device);
  return { id: device.id, name: device.name || null };
}

async function resolveDevice(bluetoothId, serviceUuids) {
  if (knownDevices.has(bluetoothId)) return knownDevices.get(bluetoothId);
  if (typeof navigator.bluetooth.getDevices === 'function') {
    const granted = await navigator.bluetooth.getDevices();
    const match = granted.find((d) => d.id === bluetoothId);
    if (match) {
      knownDevices.set(bluetoothId, match);
      return match;
    }
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: serviceUuids.map((s) => ({ services: [s] })),
    optionalServices: serviceUuids,
  });
  knownDevices.set(device.id, device);
  return device;
}

export async function webConnectAndSync(bluetoothId, deviceType, { collectWindowMs = 4000, miScale = false } = {}) {
  if (!isWebBluetoothSupported()) throw new Error('This browser doesn’t support Web Bluetooth.');
  const profile = profileForDeviceType(deviceType, { preferMiScale: miScale });
  if (!profile) throw new Error(`No Bluetooth profile for device type: ${deviceType}`);

  const device = await resolveDevice(bluetoothId, [profile.serviceUuid]);
  const server = await device.gatt.connect();
  const readings = [];
  let characteristic;
  const onValue = (event) => {
    const value = event.target.value;
    if (!value) return;
    const reading = profile.parse(base64FromDataView(value));
    if (reading) readings.push(reading);
  };

  try {
    const service = await server.getPrimaryService(profile.serviceUuid);
    characteristic = await service.getCharacteristic(profile.measurementCharacteristicUuid);
    characteristic.addEventListener('characteristicvaluechanged', onValue);
    await characteristic.startNotifications();

    if (profile.requiresRacp) {
      const racp = await service.getCharacteristic(CHARACTERISTICS.RECORD_ACCESS_CONTROL_POINT);
      // The RACP responds with an indication; subscribing first is required
      // by most meters before the write is accepted.
      await racp.startNotifications().catch(() => {});
      await racp.writeValueWithResponse(new Uint8Array([RACP_OPCODE_REPORT_STORED_RECORDS, RACP_OPERATOR_ALL_RECORDS]));
    }
    await new Promise((resolve) => setTimeout(resolve, collectWindowMs));
  } finally {
    if (characteristic) {
      characteristic.removeEventListener('characteristicvaluechanged', onValue);
      await characteristic.stopNotifications().catch(() => {});
    }
    if (device.gatt.connected) device.gatt.disconnect();
  }
  return readings;
}
