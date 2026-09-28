-- A multi-day (7 or 15 day) diet schedule: created manually, imported from a
-- document (see diet_schedule_imports/023), or AI-generated from a "mini
-- kitchen" ingredient selection (see kitchen_items/025). Mirrors
-- 020_retest_plans.sql's multi-day-plan-with-status shape.
--
-- Every entry ends up pointing at a recipe_suggestions row (019) - manual
-- and imported entries start with none and are backfilled by
-- recipeBackfillService.js; kitchen-generated entries already have one from
-- generation itself. schedule_impact_flags caches the worsens/improves
-- cross-check against the user's abnormal labs/medications (dietInsightService.js),
-- the same cache-with-staleness-check shape diet_recommendations (012) uses.

CREATE TABLE IF NOT EXISTS diet_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days IN (7, 15)),
  start_date DATE NOT NULL,

  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'imported', 'kitchen_generated')),
  import_id UUID REFERENCES diet_schedule_imports(id) ON DELETE SET NULL,
  -- Snapshot of the kitchen_items.id list used to generate this schedule
  -- (kitchen_generated only) - kept even if those items are later edited or
  -- removed from the kitchen, so "what was on hand when this was made" stays
  -- answerable.
  kitchen_item_ids JSONB,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diet_schedules_user ON diet_schedules(user_id, status);

CREATE TABLE IF NOT EXISTS diet_schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES diet_schedules(id) ON DELETE CASCADE,

  day_number INTEGER NOT NULL CHECK (day_number >= 1),
  -- Denormalized from schedule.start_date + day_number - 1 at write time, so
  -- the calendar view can query/sort by date directly without joining back
  -- to recompute it, the same tradeoff meal_type's auto-derivation makes in
  -- food_entries (012_diet_tracking.sql).
  scheduled_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner', 'supper')),

  dish_name TEXT NOT NULL,
  -- The original cell/line this entry was read from, for an imported entry
  -- only - lets a review screen show "you wrote: ..." next to what was
  -- parsed out of it.
  raw_import_text TEXT,

  recipe_suggestion_id UUID REFERENCES recipe_suggestions(id) ON DELETE SET NULL,
  recipe_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (recipe_status IN ('pending', 'generating', 'generated', 'failed')),

  -- Set once the person taps "log" on this entry - the same
  -- food_entries.recipe_suggestion_id link dietRecipeService.logRecipeSuggestion
  -- already creates, referenced back here so the calendar can show "logged".
  food_entry_id UUID REFERENCES food_entries(id) ON DELETE SET NULL,

  -- True for a low-confidence imported entry (see dietScheduleExtractionProvider.js's
  -- 0.75 threshold, the same convention claudeProvider.js's report extraction uses).
  needs_review BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diet_schedule_entries_schedule ON diet_schedule_entries(schedule_id, day_number);
CREATE INDEX IF NOT EXISTS idx_diet_schedule_entries_recipe_pending
  ON diet_schedule_entries(schedule_id) WHERE recipe_status = 'pending';

CREATE TABLE IF NOT EXISTS schedule_impact_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL UNIQUE REFERENCES diet_schedules(id) ON DELETE CASCADE,

  -- Staleness signal, same idea as diet_recommendations.entries_analyzed_count:
  -- recomputed whenever the count of entries that actually have a generated
  -- recipe (and so contribute real nutrition) changes.
  entries_with_recipe_count INTEGER NOT NULL DEFAULT 0,

  worsens JSONB NOT NULL DEFAULT '[]'::jsonb,
  improves JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  provider TEXT NOT NULL DEFAULT 'heuristic',
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
