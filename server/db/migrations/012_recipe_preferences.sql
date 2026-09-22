-- Recipe recommendation preferences: which diet types (vegetarian/vegan/
-- non-vegetarian) and which cuisines (country-wise) a user wants recipe
-- suggestions drawn from. Multiple selections per dimension, so this is a
-- join table (one row per selected value) rather than a column on users -
-- same shape as user_pinned_parameters (011).
--
-- New users get "South Indian Vegetarian" + "Western Vegan" as the default
-- suggestion until they save their own choices; that default lives in the
-- API layer (recipePreferences.js) rather than as seeded rows here, so a
-- user who saves an empty set stays empty instead of reverting to defaults
-- on next read.

CREATE TABLE IF NOT EXISTS user_recipe_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL CHECK (preference_type IN ('diet_type', 'cuisine')),
  preference_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, preference_type, preference_value),
  CHECK (
    (preference_type = 'diet_type' AND preference_value IN ('vegetarian', 'vegan', 'non_vegetarian'))
    OR
    (preference_type = 'cuisine' AND preference_value IN (
      'south_indian', 'north_indian', 'western', 'mediterranean', 'east_asian', 'middle_eastern'
    ))
  )
);

CREATE INDEX IF NOT EXISTS idx_user_recipe_preferences_user ON user_recipe_preferences(user_id);
