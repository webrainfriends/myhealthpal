-- Adds 'phone_pedometer' as a paired_devices connection type: the phone's
-- own built-in step counter (iOS CoreMotion / Android step sensor), read
-- directly without needing HealthKit or Health Connect to be linked in.
ALTER TABLE paired_devices DROP CONSTRAINT IF EXISTS paired_devices_connection_type_check;
ALTER TABLE paired_devices
  ADD CONSTRAINT paired_devices_connection_type_check
  CHECK (connection_type IN ('ble', 'apple_health', 'health_connect', 'phone_pedometer'));
