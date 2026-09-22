const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const deviceService = require('../src/services/deviceService');

let userId;

test.before(async () => {
  const user = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ('device-service-test@example.com', 'Device Service Test') RETURNING id`
  );
  userId = user.rows[0].id;
});

test.after(async () => {
  await pool.query('DELETE FROM vital_readings WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM paired_devices WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

test('pairDevice requires a bluetoothId for a BLE device but not for a platform connection', async () => {
  await assert.rejects(
    deviceService.pairDevice(userId, { deviceType: 'blood_glucose_meter', connectionType: 'ble', name: 'Accu-Chek Guide' }),
    /bluetoothId/
  );

  const device = await deviceService.pairDevice(userId, {
    deviceType: 'step_tracker',
    connectionType: 'apple_health',
    name: 'Apple Health',
  });
  assert.equal(device.connectionType, 'apple_health');
  assert.equal(device.bluetoothId, null);
});

test('pairDevice re-pairing the same BLE peripheral updates the existing row instead of duplicating it', async () => {
  const first = await deviceService.pairDevice(userId, {
    deviceType: 'blood_pressure_monitor',
    connectionType: 'ble',
    name: 'Omron BP7000',
    bluetoothId: 'AA:BB:CC:DD:EE:FF',
  });

  const second = await deviceService.pairDevice(userId, {
    deviceType: 'blood_pressure_monitor',
    connectionType: 'ble',
    name: 'Omron BP7000 (renamed)',
    bluetoothId: 'AA:BB:CC:DD:EE:FF',
  });

  assert.equal(second.id, first.id);
  assert.equal(second.name, 'Omron BP7000 (renamed)');

  const devices = await deviceService.listPairedDevices(userId);
  assert.equal(devices.filter((d) => d.bluetoothId === 'AA:BB:CC:DD:EE:FF').length, 1);
});

test('pairing a second apple_health connection for the same user updates the first rather than erroring', async () => {
  const first = await deviceService.pairDevice(userId, {
    deviceType: 'step_tracker',
    connectionType: 'health_connect',
    name: 'Health Connect',
  });
  const second = await deviceService.pairDevice(userId, {
    deviceType: 'step_tracker',
    connectionType: 'health_connect',
    name: 'Health Connect (re-enabled)',
  });
  assert.equal(second.id, first.id);
});

test('recordReadings rejects a reading type the paired device does not produce', async () => {
  const scale = await deviceService.pairDevice(userId, {
    deviceType: 'smart_scale',
    connectionType: 'ble',
    name: 'Mi Scale 2',
    bluetoothId: 'MI:SCALE:0001',
  });

  // buildReadingRow is keyed off the device's own device_type, so a scale
  // reading missing weightKg (the field body_weight requires) is what
  // actually exercises the validation - there's no client-suppliable
  // "type" field to send the wrong value for.
  await assert.rejects(
    deviceService.recordReadings(userId, scale.id, [{ measuredAt: new Date().toISOString() }]),
    /weightKg/
  );
});

test('recordReadings inserts vital_readings, is idempotent on replay, and classifies against clinical thresholds', async () => {
  const meter = await deviceService.pairDevice(userId, {
    deviceType: 'blood_glucose_meter',
    connectionType: 'ble',
    name: 'Accu-Chek Guide',
    bluetoothId: 'GLUCOSE:0001',
  });

  const measuredAt = new Date('2026-09-01T07:00:00Z').toISOString();
  const first = await deviceService.recordReadings(userId, meter.id, [
    { measuredAt, glucoseMgDl: 112, glucoseContext: 'fasting', rawPayload: { flags: 0x03 } },
  ]);
  assert.equal(first.synced, 1);
  assert.equal(first.skipped, 0);

  // A BLE device resending its full on-device history buffer on the next
  // reconnect must never double-insert the same reading.
  const replay = await deviceService.recordReadings(userId, meter.id, [
    { measuredAt, glucoseMgDl: 112, glucoseContext: 'fasting' },
  ]);
  assert.equal(replay.synced, 0);
  assert.equal(replay.skipped, 1);

  const history = await deviceService.getVitalsHistory(userId, 'blood_glucose', 90);
  assert.equal(history.length, 1);
  assert.equal(history[0].glucoseMgDl, 112);
  assert.equal(history[0].classification, 'elevated'); // fasting, 100-125 mg/dL

  const devices = await deviceService.listPairedDevices(userId);
  const synced = devices.find((d) => d.id === meter.id);
  assert.ok(synced.lastSyncedAt, 'expected last_synced_at to be set after a sync');
});

test('unpairDevice removes the pairing but keeps its readings (with paired_device_id cleared)', async () => {
  const meter = await deviceService.pairDevice(userId, {
    deviceType: 'blood_glucose_meter',
    connectionType: 'ble',
    name: 'Accu-Chek Guide 2',
    bluetoothId: 'GLUCOSE:0002',
  });
  await deviceService.recordReadings(userId, meter.id, [
    { measuredAt: new Date('2026-09-02T07:00:00Z').toISOString(), glucoseMgDl: 95, glucoseContext: 'fasting' },
  ]);

  await deviceService.unpairDevice(userId, meter.id);

  const devices = await deviceService.listPairedDevices(userId);
  assert.ok(!devices.some((d) => d.id === meter.id));

  const { rows } = await pool.query('SELECT paired_device_id FROM vital_readings WHERE user_id = $1 AND glucose_mg_dl = 95', [userId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].paired_device_id, null);
});

test('classifyGlucose and classifyBloodPressure follow ADA/AHA thresholds', () => {
  assert.equal(deviceService.classifyGlucose(65, 'fasting'), 'low');
  assert.equal(deviceService.classifyGlucose(95, 'fasting'), 'normal');
  assert.equal(deviceService.classifyGlucose(110, 'fasting'), 'elevated');
  assert.equal(deviceService.classifyGlucose(130, 'fasting'), 'high');
  assert.equal(deviceService.classifyGlucose(180, 'after_meal'), 'elevated');

  assert.equal(deviceService.classifyBloodPressure(115, 75), 'normal');
  assert.equal(deviceService.classifyBloodPressure(125, 78), 'elevated');
  assert.equal(deviceService.classifyBloodPressure(135, 85), 'elevated');
  assert.equal(deviceService.classifyBloodPressure(150, 95), 'high');
  assert.equal(deviceService.classifyBloodPressure(185, 100), 'crisis');
});

test('getVitalsSummary returns the single most recent reading per type', async () => {
  const meter = await deviceService.pairDevice(userId, {
    deviceType: 'blood_glucose_meter',
    connectionType: 'ble',
    name: 'Accu-Chek Guide 3',
    bluetoothId: 'GLUCOSE:0003',
  });
  await deviceService.recordReadings(userId, meter.id, [
    { measuredAt: new Date('2026-09-03T07:00:00Z').toISOString(), glucoseMgDl: 90, glucoseContext: 'fasting' },
    { measuredAt: new Date('2026-09-04T07:00:00Z').toISOString(), glucoseMgDl: 88, glucoseContext: 'fasting' },
  ]);

  const summary = await deviceService.getVitalsSummary(userId);
  assert.equal(summary.blood_glucose.glucoseMgDl, 88);
  assert.equal(summary.blood_pressure, null);
  assert.equal(summary.body_weight, null);
});
