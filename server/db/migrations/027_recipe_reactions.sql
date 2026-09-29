-- Love/Like/Unlike on a specific recipe_suggestions row - the person's own
-- signal for how well a recipe (and by extension the diet it was part of)
-- actually worked for them. One reaction per (user, recipe instance): since
-- recipe_suggestions is already scoped per-user, a recipe shown in both the
-- Recipes feed and a diet schedule entry (same recipe_suggestion_id) shares
-- one reaction row naturally, with no separate per-surface table.
--
-- Deliberately an upsert-on-type table (PRIMARY KEY (user_id, recipe_suggestion_id),
-- reaction_type swapped via ON CONFLICT DO UPDATE), unlike
-- user_pinned_parameters' delete-based insert/DO NOTHING toggle
-- (003_timeline_dashboard.sql) - Love/Like/Unlike are three mutually
-- exclusive states, not a boolean, so switching reactions is a row update,
-- not a delete-then-reinsert.
CREATE TABLE IF NOT EXISTS recipe_reactions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_suggestion_id UUID NOT NULL REFERENCES recipe_suggestions(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('love', 'like', 'unlike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_suggestion_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_reactions_recipe ON recipe_reactions(recipe_suggestion_id);
