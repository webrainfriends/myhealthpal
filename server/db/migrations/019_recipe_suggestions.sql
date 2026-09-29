-- Persists every AI-generated recipe suggestion (dietRecipeService.js's
-- generateRecipeFeed) so a batch the user already paid AI tokens for is
-- never lost - not to app-session memory, not to a screen unmount, not to
-- closing the app. The Recipes screen now reads this table first (a free
-- GET, no AI call) and only calls the AI when the user explicitly taps
-- "Generate"; the Diet screen's quick-pick list reads the same table so a
-- user can log a meal from an already-generated idea without leaving that
-- screen or spending anything.
--
-- One row per recipe (not per batch): a batch has no other identity worth
-- keeping, and flattening lets "Load more" simply keep appending rows.
-- Shape mirrors food_entries' nutrient columns (012/013_diet_*.sql) so a
-- suggestion converts to a food_entries row with no field mapping beyond
-- the join itself (see dietRecipeService.logRecipeSuggestion).
CREATE TABLE IF NOT EXISTS recipe_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The meal-type FILTER the generation request used, distinct from the
  -- recipe's own meal_type below (an unfiltered batch is vared across meal
  -- types by the model) - lets a "Lunch" filter on the Recipes screen
  -- re-show exactly the batch that filter produced.
  requested_meal_type TEXT CHECK (requested_meal_type IN ('breakfast', 'lunch', 'snack', 'dinner', 'supper')),

  title TEXT NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner', 'supper')),
  description TEXT,
  servings NUMERIC,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  dietary_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  why_this_recipe TEXT,

  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  saturated_fat_g NUMERIC,
  fiber_g NUMERIC,
  sugar_g NUMERIC,
  sodium_mg NUMERIC,
  cholesterol_mg NUMERIC,
  potassium_mg NUMERIC,
  calcium_mg NUMERIC,
  iron_mg NUMERIC,
  vitamin_d_mcg NUMERIC,

  -- Set once the user taps "Add to diet" on this suggestion - lets the UI
  -- show "Added" instead of re-offering the same recipe as unlogged, and
  -- lets a logged food_entries row point back at the recipe it came from.
  added_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_suggestions_user_created ON recipe_suggestions(user_id, created_at DESC);

-- A recipe suggestion a food_entries row was logged from - optional (manual
-- and scanned entries have none), and kept even if the suggestion itself is
-- later pruned (see dietRecipeService's retention trim) since the food log
-- entry must never disappear along with it.
ALTER TABLE food_entries
  ADD COLUMN IF NOT EXISTS recipe_suggestion_id UUID REFERENCES recipe_suggestions(id) ON DELETE SET NULL;
