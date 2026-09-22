-- A wearable/health-tracker "Activity" export (MedM Health and similarly-
-- shaped aggregator exports) carries calories burned and distance alongside
-- steps - captured here rather than discarded, even though only steps has a
-- ring today. Nullable/optional like the columns already on this table.

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS calories_burned INTEGER
  CHECK (calories_burned IS NULL OR calories_burned >= 0);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS distance_meters NUMERIC
  CHECK (distance_meters IS NULL OR distance_meters >= 0);
