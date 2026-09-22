-- Bluetooth-paired and platform-health-store device integrations (glucose
-- meters like Accu-Chek Guide, blood pressure monitors like Omron, smart
-- scales like Mi Scale 2, and Apple Health/Health Connect step trackers).
--
-- Two tables, deliberately kept out of the lab-report pipeline entirely:
-- paired_devices records what a user has connected, and vital_readings
-- holds every reading synced from one. A device reading has no source
-- report, no extraction run, and no duplicate-review workflow the way a
-- lab document result does, and the health_parameters registry (built
-- entirely from lab report vocabulary - see registry-seed-data.js) has no
-- entries for blood pressure or body weight at all. Forcing these through
-- health_measurements would mean inventing a synthetic "report" per sync
-- for a NOT NULL report_id that means something different everywhere else
-- it's used. This mirrors activity_logs' own reasoning for keeping
-- wearable step data out of health_measurements.

CREATE TABLE IF NOT EXISTS paired_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL CHECK (device_type IN (
    'blood_glucose_meter', 'blood_pressure_monitor', 'smart_scale', 'step_tracker'
  )),
  -- 'ble' is a direct GATT connection this app makes to the peripheral
  -- itself (glucose meters, BP monitors, scales). Apple/Samsung step
  -- trackers are never paired this way - a phone app cannot open a BLE
  -- connection to a paired Apple Watch/Galaxy Watch (that link belongs to
  -- the OS's own companion app); their step counts instead reach this app
  -- through the platform's health data store, which is what
  -- 'apple_health' and 'health_connect' represent here.
  connection_type TEXT NOT NULL CHECK (connection_type IN ('ble', 'apple_health', 'health_connect')),
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  -- The BLE peripheral's platform identifier (iOS: a per-app-install
  -- UUID; Android: the MAC address) used to reconnect to this exact
  -- physical device on a later sync. Null for apple_health/health_connect,
  -- which have no per-peripheral identifier - one phone has at most one
  -- HealthKit store and at most one Health Connect store.
  bluetooth_id TEXT,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A given physical BLE peripheral can only be paired once per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_paired_devices_user_bluetooth_id
  ON paired_devices (user_id, bluetooth_id) WHERE bluetooth_id IS NOT NULL;

-- Apple Health / Health Connect are singleton connections (one phone, one
-- store of each) - a second "pair" of the same store is a re-enable, not a
-- second device, so it's blocked here rather than left to pile up rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_paired_devices_user_platform_connection
  ON paired_devices (user_id, connection_type) WHERE connection_type != 'ble';

CREATE INDEX IF NOT EXISTS idx_paired_devices_user_id ON paired_devices (user_id);

CREATE TABLE IF NOT EXISTS vital_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kept (not cascaded) when a device is unpaired: the readings it already
  -- contributed are the user's health history, not the device's - deleting
  -- the pairing must never delete the data it produced.
  paired_device_id UUID REFERENCES paired_devices(id) ON DELETE SET NULL,
  reading_type TEXT NOT NULL CHECK (reading_type IN ('blood_glucose', 'blood_pressure', 'body_weight')),
  measured_at TIMESTAMPTZ NOT NULL,

  -- blood_glucose (Accu-Chek Guide and similar glucometers)
  glucose_mg_dl NUMERIC CHECK (glucose_mg_dl IS NULL OR glucose_mg_dl > 0),
  glucose_context TEXT CHECK (glucose_context IS NULL OR glucose_context IN (
    'fasting', 'before_meal', 'after_meal', 'bedtime', 'general', 'unspecified'
  )),

  -- blood_pressure (Omron and similar BP monitors)
  systolic_mm_hg NUMERIC CHECK (systolic_mm_hg IS NULL OR systolic_mm_hg > 0),
  diastolic_mm_hg NUMERIC CHECK (diastolic_mm_hg IS NULL OR diastolic_mm_hg > 0),
  pulse_bpm NUMERIC CHECK (pulse_bpm IS NULL OR pulse_bpm > 0),

  -- body_weight (Mi Scale 2 and similar smart scales)
  weight_kg NUMERIC CHECK (weight_kg IS NULL OR weight_kg > 0),
  body_fat_percent NUMERIC CHECK (body_fat_percent IS NULL OR (body_fat_percent >= 0 AND body_fat_percent <= 100)),

  -- The exact decoded GATT characteristic (or HealthKit/Health Connect
  -- sample) this row came from - never shown in the UI, kept only so a
  -- decoding bug can be diagnosed against the original payload after the
  -- fact instead of only against the fields this migration anticipated.
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A BLE device commonly resends its whole on-device history buffer on
  -- every reconnect (this is normal GATT behavior, not a bug on the
  -- device's side) - re-syncing must never double-insert the same reading.
  UNIQUE (user_id, paired_device_id, reading_type, measured_at)
);

CREATE INDEX IF NOT EXISTS idx_vital_readings_user_type_date
  ON vital_readings (user_id, reading_type, measured_at DESC);
