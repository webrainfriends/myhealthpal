-- Shared/canonical recipe catalog: recipe_suggestions (019) is per-user, with
-- no place to aggregate cross-user signal. This table is the "same recipe,
-- seen across users" record that recipe_suggestions rows link to when
-- sufficiently similar (see recipeCatalogService.js's normalizeTitle/
-- ingredientSignature - a deterministic string-normalization dedup key, the
-- same spirit as normalizationService.js's alias matching, never a fuzzy
-- AI judgment call). Reaction/schedule/log counts roll up here so future AI
-- generation can be told which recipes other users with similar preferences
-- have actually responded well to.

CREATE TABLE IF NOT EXISTS canonical_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dedup key: same normalized title + cuisine + core-ingredient signature
  -- is treated as "the same recipe" across users/generations.
  normalized_title TEXT NOT NULL,
  cuisine TEXT CHECK (cuisine IN ('south_indian', 'north_indian', 'western', 'mediterranean', 'east_asian', 'middle_eastern')),
  diet_type TEXT CHECK (diet_type IN ('vegetarian', 'vegan', 'non_vegetarian')),
  ingredient_signature TEXT NOT NULL,

  -- A representative copy of the recipe content (the first one seen for
  -- this key) - shown when suggesting a popular catalog entry as context in
  -- a generation prompt; individual recipe_suggestions rows keep their own
  -- copy regardless (see 019_recipe_suggestions.sql) so this is never the
  -- source of truth for what a specific user was actually given.
  title TEXT NOT NULL,
  description TEXT,
  meal_type TEXT CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner', 'supper')),
  servings NUMERIC,
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  dietary_tags JSONB NOT NULL DEFAULT '[]'::jsonb,

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

  -- Rolled-up cross-user counts (recipeCatalogService.js recomputes these
  -- synchronously after each triggering write - cheap at this scale, no
  -- separate aggregation job needed).
  love_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  unlike_count INTEGER NOT NULL DEFAULT 0,
  added_to_schedule_count INTEGER NOT NULL DEFAULT 0,
  logged_count INTEGER NOT NULL DEFAULT 0,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (normalized_title, cuisine, ingredient_signature)
);

CREATE INDEX IF NOT EXISTS idx_canonical_recipes_popularity
  ON canonical_recipes(cuisine, diet_type, love_count DESC, like_count DESC);

-- Nullable: a recipe_suggestions row links to a canonical entry once
-- recipeCatalogService.linkOrCreate runs after it's saved; older rows (and
-- ones from before this migration) simply have no link.
ALTER TABLE recipe_suggestions ADD COLUMN IF NOT EXISTS canonical_recipe_id UUID REFERENCES canonical_recipes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_recipe_suggestions_canonical ON recipe_suggestions(canonical_recipe_id);
