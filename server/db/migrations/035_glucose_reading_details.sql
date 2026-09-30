-- The other columns a glucometer export carries besides value and meal
-- context: how the user felt, hematocrit (some meters record it alongside
-- glucose) and a free-text note. Nullable - most rows leave them empty.
ALTER TABLE glucose_readings ADD COLUMN IF NOT EXISTS feeling TEXT;
ALTER TABLE glucose_readings ADD COLUMN IF NOT EXISTS hematocrit NUMERIC;
ALTER TABLE glucose_readings ADD COLUMN IF NOT EXISTS note TEXT;
