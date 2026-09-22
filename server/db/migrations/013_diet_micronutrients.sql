-- Extends food_entries with the rest of the FDA Nutrition Facts label's
-- standard nutrient set (012_diet_tracking.sql already covers calories,
-- protein, carbs, fat, fiber, sugar, and sodium - the label's other
-- mandatory lines are saturated fat, cholesterol, and, since the 2016
-- label revision, vitamin D, calcium, iron, and potassium specifically).
-- dietPhotoProvider.js estimates these the same way it estimates the
-- existing macros - from standard nutrition data for what's visible in the
-- photo, never fabricated when the portion can't be judged.
--
-- NOTE: potassium_mg, calcium_mg, and vitamin_d_mcg are DIETARY INTAKE
-- estimates for a single logged food item - unrelated to and never
-- conflated with the same-named LAB parameters (health_parameters.code =
-- 'potassium'/'calcium'/'vitamin_d') that health_measurements stores from
-- an actual blood test. dietInsightService.js keeps these two concepts
-- separate; a diet-pattern tip cites a lab result only through the
-- existing abnormal-flagged-measurement join, never through these columns.

ALTER TABLE food_entries
  ADD COLUMN IF NOT EXISTS saturated_fat_g NUMERIC,
  ADD COLUMN IF NOT EXISTS cholesterol_mg NUMERIC,
  ADD COLUMN IF NOT EXISTS potassium_mg NUMERIC,
  ADD COLUMN IF NOT EXISTS calcium_mg NUMERIC,
  ADD COLUMN IF NOT EXISTS iron_mg NUMERIC,
  ADD COLUMN IF NOT EXISTS vitamin_d_mcg NUMERIC;
