// Standard Bluetooth SIG GATT service/characteristic UUIDs for the "Health
// Device Profile" services this app speaks - the same services almost
// every compliant home glucose meter, blood pressure monitor, and smart
// scale implements (react-native-ble-plx normalizes short 16-bit UUIDs to
// this full 128-bit form when discovering services, so these are compared
// case-insensitively against that).
// Reference: Bluetooth SIG Assigned Numbers, GATT Services/Characteristics.

function shortUuid(hex16) {
  return `0000${hex16}-0000-1000-8000-00805f9b34fb`;
}

const SERVICES = {
  DEVICE_INFORMATION: shortUuid('180a'),
  BATTERY: shortUuid('180f'),
  BLOOD_PRESSURE: shortUuid('1810'),
  GLUCOSE: shortUuid('1808'),
  WEIGHT_SCALE: shortUuid('181d'),
  // Xiaomi's Mi Body Composition Scale service - not a Bluetooth SIG
  // assigned number, reverse-engineered by the open-source scale community
  // (e.g. the openScale project). Mi Scale 2 does not implement the
  // standard WEIGHT_SCALE service above.
  MI_BODY_COMPOSITION: '0000181b-0000-3512-2118-0009af100700',
};

const CHARACTERISTICS = {
  MANUFACTURER_NAME: shortUuid('2a29'),
  MODEL_NUMBER: shortUuid('2a24'),
  BATTERY_LEVEL: shortUuid('2a19'),
  BLOOD_PRESSURE_MEASUREMENT: shortUuid('2a35'),
  GLUCOSE_MEASUREMENT: shortUuid('2a18'),
  GLUCOSE_MEASUREMENT_CONTEXT: shortUuid('2a34'),
  RECORD_ACCESS_CONTROL_POINT: shortUuid('2a52'),
  WEIGHT_MEASUREMENT: shortUuid('2a9d'),
  MI_BODY_COMPOSITION_MEASUREMENT: '00002a9c-0000-3512-2118-0009af100700',
};

// Record Access Control Point op codes - writing "report stored records >
// all records" is how a glucose meter (which has no way to "notify
// automatically", only on request) is asked to send every reading it has.
const RACP_OPCODE_REPORT_STORED_RECORDS = 0x01;
const RACP_OPERATOR_ALL_RECORDS = 0x01;

module.exports = {
  SERVICES,
  CHARACTERISTICS,
  RACP_OPCODE_REPORT_STORED_RECORDS,
  RACP_OPERATOR_ALL_RECORDS,
};
