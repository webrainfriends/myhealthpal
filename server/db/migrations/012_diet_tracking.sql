-- Diet tracking: photo-scanned or manually logged food/drink entries,
-- auto-tagged by meal type from time of day, plus a cached, regenerable
-- pattern analysis + recommendations that considers the user's confirmed
-- lab results and active medications alongside recent intake. Mirrors the
-- medication scanning module's shape (008_medications.sql) - a scan/job
-- table, a confirmable-candidate table, both starting unconfirmed when
-- AI-sourced, trusted immediately when entered by hand.

CREATE TABLE IF NOT EXISTS diet_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  -- When the photographed food/drink was actually consumed - defaults to
  -- upload time but is settable by the client (e.g. logging a photo taken
  -- a few minutes earlier) since this, not the upload time, drives which
  -- meal each identified item is tagged into.
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingestion_status TEXT NOT NULL DEFAULT 'Uploaded'
    CHECK (ingestion_status IN ('Uploaded', 'Processing', 'Needs Review', 'Completed', 'Failed')),
  processing_error TEXT,
  raw_model_output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diet_scans_user_id ON diet_scans(user_id);

CREATE TABLE IF NOT EXISTS food_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES diet_scans(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  brand TEXT,

  quantity_amount NUMERIC,
  quantity_unit TEXT CHECK (quantity_unit IN ('g', 'ml', 'serving', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other')),
  -- Grams per single serving, when known - lets a later unit-aware edit
  -- ("2 servings") rescale calories/macros without re-asking the AI.
  serving_size_grams NUMERIC,

  calories NUMERIC,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC,
  fiber_g NUMERIC,
  sugar_g NUMERIC,
  sodium_mg NUMERIC,

  -- Auto-derived from consumed_at at write time (see dietScanService's
  -- classifyMealType) - stored, not computed on read, so a user's manual
  -- override (e.g. calling a midnight snack "supper") persists even if the
  -- time-of-day bands are ever retuned later.
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'snack', 'dinner', 'supper')),
  consumed_at TIMESTAMPTZ NOT NULL,

  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('photo_scan', 'manual')),

  -- Same unconfirmed-until-reviewed lifecycle as a scanned medication
  -- (008_medications.sql): a photo-identified item starts unconfirmed so
  -- the user corrects/fills in anything the model couldn't read (most
  -- often quantity/serving size, which drives the calorie estimate) before
  -- it counts toward summaries or recommendations.
  extraction_confidence NUMERIC(4,3),
  -- True when the model could identify the item but not confidently size
  -- it (no visible package, no countable unit) - the quantity/serving
  -- fields are left null rather than guessed, and the review screen asks
  -- the user directly instead of silently defaulting to "1 serving".
  needs_quantity BOOLEAN NOT NULL DEFAULT false,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  is_confirmed BOOLEAN NOT NULL DEFAULT true,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_entries_user_id ON food_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_food_entries_user_consumed_at ON food_entries(user_id, consumed_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_entries_scan_id ON food_entries(scan_id);

-- One cached "current" pattern-analysis + recommendations result per user -
-- regenerated on request (GET /api/diet/recommendations) rather than kept
-- as a dismissible lifecycle list like `insights`: unlike a lab-result
-- insight, this always reflects a rolling recent window, so there's no
-- single past instant worth preserving as "superseded" - only ever the
-- latest read of the user's current pattern. entries_analyzed_count +
-- generated_at let the route decide staleness (new confirmed entries since
-- last generation) without a separate versioning table.
CREATE TABLE IF NOT EXISTS diet_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  window_days INTEGER NOT NULL,
  entries_analyzed_count INTEGER NOT NULL DEFAULT 0,
  latest_entry_considered_at TIMESTAMPTZ,
  summary TEXT NOT NULL,
  -- [{title, detail, severity}] - detail text is either the heuristic
  -- template or a Claude rephrasing validated to only reference numbers
  -- present in `evidence` (see insightExplanationService.js's guard, reused
  -- the same way here) - never free-form model output taken on faith.
  tips JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Structured numbers/facts the tips are allowed to cite: daily calorie
  -- and macro averages, meal-timing counts, matched lab flags, matched
  -- active-medication dietary considerations. Kept alongside the rendered
  -- tips so the UI can show "why" and so regeneration can re-validate.
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL DEFAULT 'heuristic',
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
