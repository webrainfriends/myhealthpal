// Pure decoders for the Bluetooth SIG "Health Device Profile" GATT
// characteristic payloads (Blood Pressure Measurement, Glucose Measurement,
// Weight Measurement) plus a best-effort decoder for the Mi Scale 2's
// proprietary payload. Deliberately dependency-free (no react-native-ble-plx,
// no RN Buffer polyfill) - only Uint8Array/DataView/atob-free base64
// decoding, so these run and can be unit-tested under plain Node exactly as
// they run on-device.

// react-native-ble-plx hands characteristic values back as base64 strings
// (the underlying Android/iOS BLE APIs both deal in base64 over the RN
// bridge) - every parser below starts from that same base64 string.
function base64ToBytes(base64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = alphabet.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

// The inverse of base64ToBytes - used only to encode short outgoing
// control-point writes (e.g. the glucose meter's "report all records"
// request), never for decoding a characteristic's value.
function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    result += alphabet[bytes[i] >> 2];
    result += alphabet[((bytes[i] & 0x03) << 4) | (bytes[i + 1] >> 4)];
    result += alphabet[((bytes[i + 1] & 0x0f) << 2) | (bytes[i + 2] >> 6)];
    result += alphabet[bytes[i + 2] & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    result += alphabet[bytes[i] >> 2];
    result += alphabet[(bytes[i] & 0x03) << 4];
    result += '==';
  } else if (remaining === 2) {
    result += alphabet[bytes[i] >> 2];
    result += alphabet[((bytes[i] & 0x03) << 4) | (bytes[i + 1] >> 4)];
    result += alphabet[(bytes[i + 1] & 0x0f) << 2];
    result += '=';
  }
  return result;
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// IEEE-11073 16-bit SFLOAT: a 4-bit signed exponent and 12-bit signed
// mantissa packed into one uint16 (LE on the wire). Used by every numeric
// field in the Blood Pressure and Glucose Measurement characteristics.
// Returns null for the spec's reserved "not a number" encodings.
function readSFloat(dv, offset) {
  const raw = dv.getUint16(offset, true);
  let mantissa = raw & 0x0fff;
  let exponent = (raw >> 12) & 0x000f;
  if (exponent >= 0x8) exponent -= 0x10; // 4-bit two's complement
  if (mantissa === 0x07ff || mantissa === 0x0800 || mantissa === 0x0801) return null; // NaN/+INFINITY/-INFINITY
  if (mantissa >= 0x0800) mantissa -= 0x1000; // 12-bit two's complement
  return mantissa * 10 ** exponent;
}

// Bluetooth SIG "org.bluetooth.characteristic.date_time" base type: used
// (as a 7-byte prefix) by both the Blood Pressure and Glucose Measurement
// Time Stamp fields. Year 0 means "unknown" per spec - callers fall back to
// the sync time in that case rather than producing a bogus 1900-ish date.
function readDateTime(dv, offset) {
  const year = dv.getUint16(offset, true);
  const month = dv.getUint8(offset + 2);
  const day = dv.getUint8(offset + 3);
  const hours = dv.getUint8(offset + 4);
  const minutes = dv.getUint8(offset + 5);
  const seconds = dv.getUint8(offset + 6);
  if (year === 0 || month === 0 || day === 0) return null;
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

// Blood Pressure Measurement (0x2A35) - GATT Specification Supplement.
function parseBloodPressureMeasurement(base64Value) {
  const bytes = base64ToBytes(base64Value);
  const dv = view(bytes);
  let offset = 0;

  const flags = dv.getUint8(offset);
  offset += 1;
  const unitsKpa = Boolean(flags & 0x01);
  const hasTimestamp = Boolean(flags & 0x02);
  const hasPulse = Boolean(flags & 0x04);

  const systolicRaw = readSFloat(dv, offset);
  offset += 2;
  const diastolicRaw = readSFloat(dv, offset);
  offset += 2;
  const meanArterialRaw = readSFloat(dv, offset);
  offset += 2;

  // The characteristic can report in kPa - convert to mmHg (the unit this
  // app stores everything in) so a kPa-configured monitor still lands in
  // the same column as an mmHg one. 1 mmHg = 0.133322 kPa.
  const toMmHg = (value) => (value === null ? null : unitsKpa ? value / 0.133322 : value);

  let measuredAt = null;
  if (hasTimestamp) {
    measuredAt = readDateTime(dv, offset);
    offset += 7;
  }

  let pulseBpm = null;
  if (hasPulse) {
    pulseBpm = readSFloat(dv, offset);
    offset += 2;
  }

  return {
    systolicMmHg: toMmHg(systolicRaw),
    diastolicMmHg: toMmHg(diastolicRaw),
    meanArterialPressureMmHg: toMmHg(meanArterialRaw),
    pulseBpm,
    measuredAt,
  };
}

// Glucose Measurement (0x2A18) sample type (upper nibble of the
// Type-Sample Location byte) - carried through mainly for display; not
// used for clinical classification.
const GLUCOSE_SAMPLE_TYPES = {
  1: 'capillary_whole_blood',
  2: 'capillary_plasma',
  3: 'venous_whole_blood',
  4: 'venous_plasma',
  5: 'arterial_whole_blood',
  6: 'arterial_plasma',
  7: 'undetermined_whole_blood',
  8: 'undetermined_plasma',
  9: 'interstitial_fluid',
  10: 'control_solution',
};

// Glucose Measurement (0x2A18) - GATT Specification Supplement. Note this
// characteristic alone does not say "fasting" vs. "after meal" - that
// requires correlating with the separate Glucose Measurement Context
// (0x2A34) characteristic by sequence number, which this app does not
// attempt to read; callers should treat the reading as 'general' context
// unless the mobile UI lets the person tag it themselves at sync time.
function parseGlucoseMeasurement(base64Value) {
  const bytes = base64ToBytes(base64Value);
  const dv = view(bytes);
  let offset = 0;

  const flags = dv.getUint8(offset);
  offset += 1;
  const hasTimeOffset = Boolean(flags & 0x01);
  const hasConcentration = Boolean(flags & 0x02);
  const molPerLiter = Boolean(flags & 0x04);

  const sequenceNumber = dv.getUint16(offset, true);
  offset += 2;

  let measuredAt = readDateTime(dv, offset);
  offset += 7;

  if (hasTimeOffset) {
    const timeOffsetMinutes = dv.getInt16(offset, true);
    offset += 2;
    if (measuredAt) measuredAt = new Date(measuredAt.getTime() + timeOffsetMinutes * 60000);
  }

  let glucoseMgDl = null;
  let sampleType = null;
  let sampleLocation = null;
  if (hasConcentration) {
    const concentration = readSFloat(dv, offset);
    offset += 2;
    // kg/L -> mg/dL: 1 kg/L = 1e6 mg / 10 dL = 100000 mg/dL.
    // mol/L -> mg/dL: glucose's molar mass is ~180.16 g/mol, so
    // 1 mol/L = 180160 mg/L = 18016 mg/dL.
    if (concentration !== null) {
      glucoseMgDl = molPerLiter ? concentration * 18016 : concentration * 100000;
    }
    const typeLocation = dv.getUint8(offset);
    offset += 1;
    sampleType = GLUCOSE_SAMPLE_TYPES[typeLocation & 0x0f] || null;
    sampleLocation = (typeLocation >> 4) & 0x0f;
  }

  return {
    sequenceNumber,
    glucoseMgDl: glucoseMgDl === null ? null : Math.round(glucoseMgDl * 10) / 10,
    sampleType,
    sampleLocation,
    measuredAt,
  };
}

// Weight Measurement (0x2A9D) - GATT Specification Supplement. Standard
// service most modern BLE smart scales implement.
function parseWeightMeasurement(base64Value) {
  const bytes = base64ToBytes(base64Value);
  const dv = view(bytes);
  let offset = 0;

  const flags = dv.getUint8(offset);
  offset += 1;
  const imperial = Boolean(flags & 0x01);
  const hasTimestamp = Boolean(flags & 0x02);
  const hasUserId = Boolean(flags & 0x04);
  const hasBmiHeight = Boolean(flags & 0x08);

  const weightRaw = dv.getUint16(offset, true);
  offset += 2;
  // SI resolution is 0.005 kg/unit, Imperial is 0.01 lb/unit (1 lb =
  // 0.45359237 kg) - always normalized to kg for storage.
  const weightKg = imperial ? weightRaw * 0.01 * 0.45359237 : weightRaw * 0.005;

  let measuredAt = null;
  if (hasTimestamp) {
    measuredAt = readDateTime(dv, offset);
    offset += 7;
  }

  if (hasUserId) offset += 1;

  let bmi = null;
  let heightM = null;
  if (hasBmiHeight) {
    bmi = dv.getUint16(offset, true) * 0.1;
    offset += 2;
    const heightRaw = dv.getUint16(offset, true);
    offset += 2;
    heightM = imperial ? heightRaw * 0.1 * 0.0254 : heightRaw * 0.001;
  }

  return {
    weightKg: Math.round(weightKg * 100) / 100,
    bmi,
    heightM,
    measuredAt,
  };
}

// Mi Body Composition Scale (Mi Scale 2) - Xiaomi never published an
// official spec for this characteristic; this layout is the one documented
// by the open-source scale community (the openScale project's Xiaomi
// device support) from reverse-engineering real hardware. EXPERIMENTAL:
// unlike the standard parsers above, this has not been verified against a
// physical Mi Scale 2 in this change - treat weightKg as provisional and
// re-check against a real device before relying on it.
//
// Byte layout: [0-1] control flags (LE), [2-8] date/time (year LE, month,
// day, hour, min, sec - same shape as readDateTime), [9-10] impedance (LE,
// ohms, only meaningful when bare feet bridge both electrodes),
// [11-12] weight (LE, unscaled).
function parseMiScaleMeasurement(base64Value) {
  const bytes = base64ToBytes(base64Value);
  const dv = view(bytes);

  const controlBytes = dv.getUint16(0, true);
  const isStabilized = Boolean(controlBytes & 0x0020);
  const isImperial = Boolean(controlBytes & 0x0001);
  const weightRemoved = Boolean(controlBytes & 0x0080);

  const measuredAt = readDateTime(dv, 2);
  const impedanceRaw = dv.getUint16(9, true);
  const weightRaw = dv.getUint16(11, true);

  // Xiaomi scales report weight in catty (jin, 0.5 kg) when the imperial
  // flag is set and lb otherwise never observed on Mi Scale 2 - in
  // practice this device always reports SI kg with weightRaw/200.
  const weightKg = isImperial ? weightRaw / 100 : weightRaw / 200;

  return {
    weightKg: Math.round(weightKg * 100) / 100,
    impedanceOhm: impedanceRaw > 0 && impedanceRaw < 0xffff ? impedanceRaw : null,
    measuredAt,
    stabilized: isStabilized,
    weightRemoved,
  };
}

module.exports = {
  base64ToBytes,
  bytesToBase64,
  readSFloat,
  readDateTime,
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  parseWeightMeasurement,
  parseMiScaleMeasurement,
  GLUCOSE_SAMPLE_TYPES,
};
