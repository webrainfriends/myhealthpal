const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  parseWeightMeasurement,
  parseMiScaleMeasurement,
  bytesToBase64,
  base64ToBytes,
} = require('../src/ble/parsers');

// Builds the same base64 payload react-native-ble-plx would hand the app
// from a real characteristic notification - tests only ever use Node's own
// Buffer to construct fixtures, never to decode them (that's what the
// parser under test does, using its own dependency-free base64 decoder).
function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function sfloatBytes(value, exponent = 0) {
  const mantissa = Math.round(value / 10 ** exponent);
  const raw = (((exponent & 0xf) << 12) | (mantissa & 0x0fff)) & 0xffff;
  return [raw & 0xff, (raw >> 8) & 0xff];
}

function uint16le(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function dateTimeBytes(year, month, day, hour, minute, second) {
  return [...uint16le(year), month, day, hour, minute, second];
}

test('parseBloodPressureMeasurement decodes systolic/diastolic/MAP/pulse and a timestamp (Omron-shaped payload)', () => {
  const bytes = [
    0x06, // flags: timestamp present, pulse present, mmHg units
    ...sfloatBytes(120), // systolic
    ...sfloatBytes(80), // diastolic
    ...sfloatBytes(93), // MAP
    ...dateTimeBytes(2026, 9, 1, 7, 0, 0),
    ...sfloatBytes(72), // pulse
  ];

  const result = parseBloodPressureMeasurement(toBase64(bytes));

  assert.equal(result.systolicMmHg, 120);
  assert.equal(result.diastolicMmHg, 80);
  assert.equal(result.meanArterialPressureMmHg, 93);
  assert.equal(result.pulseBpm, 72);
  assert.equal(result.measuredAt.toISOString(), '2026-09-01T07:00:00.000Z');
});

test('parseBloodPressureMeasurement converts kPa units to mmHg', () => {
  // 120 mmHg ~= 15.9986 kPa (using the same 0.133322 factor the parser
  // divides by), encoded as an SFLOAT with one decimal of precision.
  const kPa = 16.0;
  const bytes = [
    0x01, // flags: kPa units, no timestamp, no pulse
    ...sfloatBytes(kPa, -1),
    ...sfloatBytes(kPa, -1),
    ...sfloatBytes(kPa, -1),
  ];

  const result = parseBloodPressureMeasurement(toBase64(bytes));
  assert.ok(Math.abs(result.systolicMmHg - 120) < 0.5, `expected ~120 mmHg, got ${result.systolicMmHg}`);
});

test('parseGlucoseMeasurement decodes a kg/L concentration to mg/dL (Accu-Chek Guide-shaped payload)', () => {
  const bytes = [
    0x02, // flags: concentration present, kg/L units, no time offset
    ...uint16le(1), // sequence number
    ...dateTimeBytes(2026, 9, 2, 6, 30, 0),
    ...sfloatBytes(0.001, -3), // 0.001 kg/L -> 100 mg/dL
    0x11, // type=1 (capillary whole blood), location=1 (finger)
  ];

  const result = parseGlucoseMeasurement(toBase64(bytes));

  assert.equal(result.sequenceNumber, 1);
  assert.equal(result.glucoseMgDl, 100);
  assert.equal(result.sampleType, 'capillary_whole_blood');
  assert.equal(result.measuredAt.toISOString(), '2026-09-02T06:30:00.000Z');
});

test('parseGlucoseMeasurement decodes a mol/L concentration to mg/dL', () => {
  const bytes = [
    0x06, // flags: concentration present, mol/L units
    ...uint16le(2),
    ...dateTimeBytes(2026, 9, 2, 6, 31, 0),
    ...sfloatBytes(0.0055, -4), // 0.0055 mol/L -> ~99.1 mg/dL
    0x11,
  ];

  const result = parseGlucoseMeasurement(toBase64(bytes));
  assert.ok(Math.abs(result.glucoseMgDl - 99.1) < 0.2, `expected ~99.1 mg/dL, got ${result.glucoseMgDl}`);
});

test('parseWeightMeasurement decodes an SI-kg reading with a timestamp (generic BLE scale-shaped payload)', () => {
  const bytes = [
    0x02, // flags: timestamp present, SI (kg) units
    ...uint16le(Math.round(70.5 / 0.005)),
    ...dateTimeBytes(2026, 9, 3, 8, 0, 0),
  ];

  const result = parseWeightMeasurement(toBase64(bytes));
  assert.equal(result.weightKg, 70.5);
  assert.equal(result.measuredAt.toISOString(), '2026-09-03T08:00:00.000Z');
});

test('parseMiScaleMeasurement decodes weight, impedance, and the stabilized flag', () => {
  const bytes = [
    ...uint16le(0x0020), // control flags: stabilized, SI kg
    ...dateTimeBytes(2026, 9, 5, 8, 15, 0),
    ...uint16le(500), // impedance ohms
    ...uint16le(72.4 * 200), // weight raw (kg * 200)
  ];

  const result = parseMiScaleMeasurement(toBase64(bytes));
  assert.equal(result.weightKg, 72.4);
  assert.equal(result.impedanceOhm, 500);
  assert.equal(result.stabilized, true);
  assert.equal(result.measuredAt.toISOString(), '2026-09-05T08:15:00.000Z');
});

test('bytesToBase64 round-trips through base64ToBytes for the RACP "report all records" write', () => {
  // The exact 2-byte payload bleService.js writes to the Record Access
  // Control Point to ask a glucose meter for its full stored history.
  const opcodeAndOperator = [0x01, 0x01];
  const encoded = bytesToBase64(opcodeAndOperator);
  const decoded = Array.from(base64ToBytes(encoded));
  assert.deepEqual(decoded, opcodeAndOperator);
});

test('bytesToBase64 matches Node\'s own base64 encoding for varied lengths', () => {
  for (const bytes of [[0], [1, 2], [1, 2, 3], [1, 2, 3, 4], [255, 0, 128, 64, 32]]) {
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
});
