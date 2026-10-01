-- Dose timing beyond "N times a day": the person (or the prescription read)
-- can pick several times of day (times_of_day), an "every X hours" interval,
-- and a food relation (before / after / with food, empty stomach).
ALTER TABLE medications ADD COLUMN IF NOT EXISTS interval_hours NUMERIC CHECK (interval_hours IS NULL OR (interval_hours >= 1 AND interval_hours <= 24));
ALTER TABLE medications ADD COLUMN IF NOT EXISTS food_relation TEXT;
ALTER TABLE medications DROP CONSTRAINT IF EXISTS medications_food_relation_check;
ALTER TABLE medications ADD CONSTRAINT medications_food_relation_check
  CHECK (food_relation IS NULL OR food_relation IN ('before_food', 'after_food', 'with_food', 'empty_stomach'));
