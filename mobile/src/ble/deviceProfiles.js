const { SERVICES, CHARACTERISTICS } = require('./gattConstants');
const {
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  parseWeightMeasurement,
  parseMiScaleMeasurement,
} = require('./parsers');

// One entry per device_type this app can pair over BLE (everything except
// 'step_tracker', which never speaks BLE directly to this app - see
// mobile/src/health/stepSync.js). Each profile says which GATT service to
// look for while scanning, which characteristic carries the actual
// reading, and how to turn its notification payload into the reading
// shape server/src/services/deviceService.js expects.
const DEVICE_PROFILES = {
  blood_glucose_meter: {
    label: 'Blood glucose meter',
    examples: ['Accu-Chek Guide', 'Contour Next One', 'OneTouch Verio Flex'],
    serviceUuid: SERVICES.GLUCOSE,
    measurementCharacteristicUuid: CHARACTERISTICS.GLUCOSE_MEASUREMENT,
    // A glucose meter has no way to push new readings on its own - it only
    // ever reports its on-device history when explicitly asked over the
    // Record Access Control Point, so this profile is also flagged as
    // needing the RACP "report all records" handshake (see bleService.js).
    requiresRacp: true,
    parse(base64Value) {
      const parsed = parseGlucoseMeasurement(base64Value);
      if (parsed.glucoseMgDl === null) return null;
      return {
        measuredAt: (parsed.measuredAt || new Date()).toISOString(),
        glucoseMgDl: parsed.glucoseMgDl,
        // The Measurement characteristic alone never says "fasting" - see
        // parseGlucoseMeasurement's own note. Left for the person to set
        // when reviewing the synced reading in the app.
        glucoseContext: 'unspecified',
        rawPayload: parsed,
      };
    },
  },
  blood_pressure_monitor: {
    label: 'Blood pressure monitor',
    examples: ['Omron Platinum BP7000', 'Omron Evolv', 'Beurer BM 57'],
    serviceUuid: SERVICES.BLOOD_PRESSURE,
    measurementCharacteristicUuid: CHARACTERISTICS.BLOOD_PRESSURE_MEASUREMENT,
    requiresRacp: false,
    parse(base64Value) {
      const parsed = parseBloodPressureMeasurement(base64Value);
      if (parsed.systolicMmHg === null || parsed.diastolicMmHg === null) return null;
      return {
        measuredAt: (parsed.measuredAt || new Date()).toISOString(),
        systolicMmHg: parsed.systolicMmHg,
        diastolicMmHg: parsed.diastolicMmHg,
        pulseBpm: parsed.pulseBpm,
        rawPayload: parsed,
      };
    },
  },
  smart_scale: {
    label: 'Smart scale',
    examples: ['Mi Scale 2', 'Withings Body', 'Eufy Smart Scale P1'],
    serviceUuid: SERVICES.WEIGHT_SCALE,
    measurementCharacteristicUuid: CHARACTERISTICS.WEIGHT_MEASUREMENT,
    requiresRacp: false,
    parse(base64Value) {
      const parsed = parseWeightMeasurement(base64Value);
      if (parsed.weightKg === null) return null;
      return {
        measuredAt: (parsed.measuredAt || new Date()).toISOString(),
        weightKg: parsed.weightKg,
        rawPayload: parsed,
      };
    },
  },
};

// Mi Scale 2 doesn't implement the standard Weight Scale Service the
// 'smart_scale' profile above scans for - it advertises a proprietary
// service instead (see gattConstants.js and parsers.js's own notes on
// this being reverse-engineered, not an official spec). Tried as a
// fallback specifically when pairing a device the person has labeled as a
// Mi Scale, rather than during a generic "smart scale" scan.
const MI_SCALE_PROFILE = {
  label: 'Mi Scale 2 (experimental)',
  serviceUuid: SERVICES.MI_BODY_COMPOSITION,
  measurementCharacteristicUuid: CHARACTERISTICS.MI_BODY_COMPOSITION_MEASUREMENT,
  requiresRacp: false,
  parse(base64Value) {
    const parsed = parseMiScaleMeasurement(base64Value);
    if (parsed.weightKg === null || parsed.weightRemoved) return null;
    return {
      measuredAt: (parsed.measuredAt || new Date()).toISOString(),
      weightKg: parsed.weightKg,
      rawPayload: parsed,
    };
  },
};

function profileForDeviceType(deviceType, { preferMiScale = false } = {}) {
  if (deviceType === 'smart_scale' && preferMiScale) return MI_SCALE_PROFILE;
  return DEVICE_PROFILES[deviceType] || null;
}

// Every service UUID a scan should filter on, across all BLE-pairable
// device types - passed straight to BleManager.startDeviceScan so the OS
// only surfaces peripherals actually advertising one of these, instead of
// every BLE device in range.
function allScannableServiceUuids() {
  return [...Object.values(DEVICE_PROFILES).map((p) => p.serviceUuid), MI_SCALE_PROFILE.serviceUuid];
}

module.exports = {
  DEVICE_PROFILES,
  MI_SCALE_PROFILE,
  profileForDeviceType,
  allScannableServiceUuids,
};
