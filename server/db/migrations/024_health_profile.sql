-- Health Profile (Settings): weight and height over time, plus a simple
-- allergy list, so "first recorded" and "current" are both real values.
-- Deliberately separate from user_weight_goals (017) - that table is a
-- target the user sets for recipe suggestions and is replaced, not
-- accumulated; these are measurements, recorded as an append-only history,
-- same reasoning as that migration's own note about what a history table
-- for weight would look like. BMI is computed live from the latest weight
-- + height, not stored, since it is entirely derived from the two.

CREATE TABLE IF NOT EXISTS user_weight_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight_kg NUMERIC(5,1) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_weight_entries_user ON user_weight_entries(user_id, recorded_at);

CREATE TABLE IF NOT EXISTS user_height_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  height_cm NUMERIC(5,1) NOT NULL CHECK (height_cm > 0 AND height_cm < 300),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_height_entries_user ON user_height_entries(user_id, recorded_at);

-- A simple self-reported list, not a clinical record. One row per distinct
-- allergen so it can be safely cross-checked against diet suggestions
-- (dietRecipeService.js) without re-parsing free text.
CREATE TABLE IF NOT EXISTS user_allergies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, allergen)
);

CREATE INDEX IF NOT EXISTS idx_user_allergies_user ON user_allergies(user_id);
