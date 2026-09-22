const pool = require('../db/pool');

const DEVICE_TYPES = ['blood_glucose_meter', 'blood_pressure_monitor', 'smart_scale', 'step_tracker'];
const CONNECTION_TYPES = ['ble', 'apple_health', 'health_connect'];
const READING_TYPES = ['blood_glucose', 'blood_pressure', 'body_weight'];

// Which reading_type a device_type is allowed to submit - a paired glucose
// meter has no business posting a weight reading, whichever app bug or
// stray GATT payload might otherwise produce one.
const DEVICE_TYPE_READING_TYPE = {
  blood_glucose_meter: 'blood_glucose',
  blood_pressure_monitor: 'blood_pressure',
  smart_scale: 'body_weight',
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function toDevice(row) {
  return {
    id: row.id,
    deviceType: row.device_type,
    connectionType: row.connection_type,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    bluetoothId: row.bluetooth_id,
    pairedAt: row.paired_at,
    lastSyncedAt: row.last_synced_at,
  };
}

async function listPairedDevices(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM paired_devices WHERE user_id = $1 ORDER BY paired_at DESC`,
    [userId]
  );
  return rows.map(toDevice);
}

// Pairing is an upsert, not a plain insert: reconnecting to a BLE
// peripheral the user already paired (same bluetooth_id), or re-enabling
// Apple Health/Health Connect after having disabled it, should refresh the
// existing row rather than fail on the unique index or silently create a
// second one - see the two partial unique indexes in the migration.
async function pairDevice(userId, fields) {
  const deviceType = fields.deviceType;
  const connectionType = fields.connectionType;
  const name = (fields.name || '').trim();

  if (!DEVICE_TYPES.includes(deviceType)) throw badRequest(`Unsupported device type: ${deviceType}`);
  if (!CONNECTION_TYPES.includes(connectionType)) throw badRequest(`Unsupported connection type: ${connectionType}`);
  if (!name) throw badRequest('Device name is required');

  const bluetoothId = connectionType === 'ble' ? (fields.bluetoothId || '').trim() : null;
  if (connectionType === 'ble' && !bluetoothId) {
    throw badRequest('bluetoothId is required for a BLE device');
  }

  const params = [userId, deviceType, connectionType, name, fields.manufacturer || null, fields.model || null, bluetoothId];

  const conflictClause =
    connectionType === 'ble'
      ? 'ON CONFLICT (user_id, bluetooth_id) WHERE bluetooth_id IS NOT NULL'
      : 'ON CONFLICT (user_id, connection_type) WHERE connection_type != \'ble\'';

  const { rows } = await pool.query(
    `INSERT INTO paired_devices (user_id, device_type, connection_type, name, manufacturer, model, bluetooth_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ${conflictClause} DO UPDATE SET
       device_type = EXCLUDED.device_type,
       name = EXCLUDED.name,
       manufacturer = EXCLUDED.manufacturer,
       model = EXCLUDED.model,
       paired_at = now()
     RETURNING *`,
    params
  );

  return toDevice(rows[0]);
}

async function renameDevice(userId, deviceId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw badRequest('Device name is required');

  const { rows } = await pool.query(
    `UPDATE paired_devices SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *`,
    [deviceId, userId, trimmed]
  );
  if (rows.length === 0) throw notFound('Device not found');
  return toDevice(rows[0]);
}

// Unpairs the device but keeps every reading it already synced - see the
// ON DELETE SET NULL on vital_readings.paired_device_id in the migration.
async function unpairDevice(userId, deviceId) {
  const { rowCount } = await pool.query(
    `DELETE FROM paired_devices WHERE id = $1 AND user_id = $2`,
    [deviceId, userId]
  );
  if (rowCount === 0) throw notFound('Device not found');
}

async function getDeviceForUser(userId, deviceId) {
  const { rows } = await pool.query(
    `SELECT * FROM paired_devices WHERE id = $1 AND user_id = $2`,
    [deviceId, userId]
  );
  if (rows.length === 0) throw notFound('Device not found');
  return rows[0];
}

function coerceNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// One reading, already shaped by the reading_type it belongs to - the BLE
// parsing layer (mobile) and any future platform-health-store sync both
// produce this same shape, so this is the one place server-side that knows
// which columns each type actually uses.
function buildReadingRow(userId, pairedDeviceId, readingType, reading) {
  const measuredAt = reading.measuredAt ? new Date(reading.measuredAt) : null;
  if (!measuredAt || Number.isNaN(measuredAt.getTime())) {
    throw badRequest('Each reading needs a valid measuredAt timestamp');
  }

  const row = {
    user_id: userId,
    paired_device_id: pairedDeviceId,
    reading_type: readingType,
    measured_at: measuredAt.toISOString(),
    glucose_mg_dl: null,
    glucose_context: null,
    systolic_mm_hg: null,
    diastolic_mm_hg: null,
    pulse_bpm: null,
    weight_kg: null,
    body_fat_percent: null,
    raw_payload: reading.rawPayload ? JSON.stringify(reading.rawPayload) : null,
  };

  if (readingType === 'blood_glucose') {
    row.glucose_mg_dl = coerceNumeric(reading.glucoseMgDl);
    if (row.glucose_mg_dl === null) throw badRequest('blood_glucose reading needs glucoseMgDl');
    row.glucose_context = reading.glucoseContext || 'unspecified';
  } else if (readingType === 'blood_pressure') {
    row.systolic_mm_hg = coerceNumeric(reading.systolicMmHg);
    row.diastolic_mm_hg = coerceNumeric(reading.diastolicMmHg);
    if (row.systolic_mm_hg === null || row.diastolic_mm_hg === null) {
      throw badRequest('blood_pressure reading needs systolicMmHg and diastolicMmHg');
    }
    row.pulse_bpm = coerceNumeric(reading.pulseBpm);
  } else if (readingType === 'body_weight') {
    row.weight_kg = coerceNumeric(reading.weightKg);
    if (row.weight_kg === null) throw badRequest('body_weight reading needs weightKg');
    row.body_fat_percent = coerceNumeric(reading.bodyFatPercent);
  }

  return row;
}

// Inserts a batch of readings synced from one paired device. Idempotent by
// design (see the UNIQUE constraint on vital_readings) so replaying a
// device's full on-device buffer after every reconnect is always safe -
// callers don't need to track "what have I already sent" themselves.
async function recordReadings(userId, deviceId, readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    throw badRequest('At least one reading is required');
  }

  const device = await getDeviceForUser(userId, deviceId);
  const expectedType = DEVICE_TYPE_READING_TYPE[device.device_type];
  if (!expectedType) {
    throw badRequest(`${device.device_type} devices do not sync vital readings`);
  }

  const rows = readings.map((reading) => buildReadingRow(userId, deviceId, expectedType, reading));

  let synced = 0;
  await pool.query('BEGIN');
  try {
    for (const row of rows) {
      const { rowCount } = await pool.query(
        `INSERT INTO vital_readings
           (user_id, paired_device_id, reading_type, measured_at, glucose_mg_dl, glucose_context,
            systolic_mm_hg, diastolic_mm_hg, pulse_bpm, weight_kg, body_fat_percent, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, paired_device_id, reading_type, measured_at) DO NOTHING`,
        [
          row.user_id, row.paired_device_id, row.reading_type, row.measured_at,
          row.glucose_mg_dl, row.glucose_context, row.systolic_mm_hg, row.diastolic_mm_hg,
          row.pulse_bpm, row.weight_kg, row.body_fat_percent, row.raw_payload,
        ]
      );
      synced += rowCount;
    }
    await pool.query(`UPDATE paired_devices SET last_synced_at = now() WHERE id = $1`, [deviceId]);
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  return { synced, skipped: rows.length - synced, readingType: expectedType };
}

// Fixed, published clinical thresholds (ADA for glucose, AHA for blood
// pressure) used only to color a reading in the UI - deliberately not the
// Health Parameter Registry's reference_ranges system, which is built for
// lab-report parameters with a health_parameter_id and has no glucose/BP/
// weight home-monitoring entries to begin with (see the migration).
function classifyGlucose(mgDl, context) {
  if (mgDl === null) return null;
  const fasting = context === 'fasting';
  if (fasting) {
    if (mgDl < 70) return 'low';
    if (mgDl <= 99) return 'normal';
    if (mgDl <= 125) return 'elevated';
    return 'high';
  }
  if (mgDl < 70) return 'low';
  if (mgDl < 140) return 'normal';
  if (mgDl <= 200) return 'elevated';
  return 'high';
}

function classifyBloodPressure(systolic, diastolic) {
  if (systolic === null || diastolic === null) return null;
  if (systolic >= 180 || diastolic >= 120) return 'crisis';
  if (systolic >= 140 || diastolic >= 90) return 'high';
  if (systolic >= 130 || diastolic >= 80) return 'elevated';
  if (systolic >= 120) return 'elevated';
  return 'normal';
}

function classifyReading(readingType, row) {
  if (readingType === 'blood_glucose') return classifyGlucose(row.glucose_mg_dl, row.glucose_context);
  if (readingType === 'blood_pressure') return classifyBloodPressure(row.systolic_mm_hg, row.diastolic_mm_hg);
  return null;
}

function toReading(row) {
  const numeric = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id,
    pairedDeviceId: row.paired_device_id,
    readingType: row.reading_type,
    measuredAt: row.measured_at,
    glucoseMgDl: numeric(row.glucose_mg_dl),
    glucoseContext: row.glucose_context,
    systolicMmHg: numeric(row.systolic_mm_hg),
    diastolicMmHg: numeric(row.diastolic_mm_hg),
    pulseBpm: numeric(row.pulse_bpm),
    weightKg: numeric(row.weight_kg),
    bodyFatPercent: numeric(row.body_fat_percent),
    classification: classifyReading(row.reading_type, row),
  };
}

async function getVitalsHistory(userId, readingType, days) {
  if (!READING_TYPES.includes(readingType)) throw badRequest(`Unsupported reading type: ${readingType}`);
  const window = Math.min(Math.max(Number.parseInt(days, 10) || 30, 1), 365);

  const { rows } = await pool.query(
    `SELECT * FROM vital_readings
     WHERE user_id = $1 AND reading_type = $2 AND measured_at >= now() - ($3::int || ' days')::interval
     ORDER BY measured_at ASC`,
    [userId, readingType, window]
  );
  return rows.map(toReading);
}

// The dashboard's compact "Vitals" card only ever needs the single most
// recent reading of each type - one query per type rather than fetching
// full history and reducing client-side.
async function getVitalsSummary(userId) {
  const summary = {};
  for (const readingType of READING_TYPES) {
    const { rows } = await pool.query(
      `SELECT * FROM vital_readings WHERE user_id = $1 AND reading_type = $2 ORDER BY measured_at DESC LIMIT 1`,
      [userId, readingType]
    );
    summary[readingType] = rows.length > 0 ? toReading(rows[0]) : null;
  }
  return summary;
}

module.exports = {
  DEVICE_TYPES,
  CONNECTION_TYPES,
  READING_TYPES,
  DEVICE_TYPE_READING_TYPE,
  listPairedDevices,
  pairDevice,
  renameDevice,
  unpairDevice,
  recordReadings,
  getVitalsHistory,
  getVitalsSummary,
  classifyGlucose,
  classifyBloodPressure,
};
