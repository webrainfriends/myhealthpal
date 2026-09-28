-- The "mini kitchen": a per-user pantry of on-hand ingredients that
-- scheduleGenerationService.js draws from to generate a diet schedule
-- constrained to what the person actually has. No existing model covers
-- this (kitchen/pantry/ingredient inventory did not exist before this
-- migration).

CREATE TABLE IF NOT EXISTS kitchen_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('vegetable', 'fruit', 'grain', 'legume', 'dairy', 'protein', 'spice', 'condiment', 'other')),

  quantity_amount NUMERIC,
  quantity_unit TEXT CHECK (quantity_unit IN ('g', 'ml', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'other')),

  -- Lets a person mark an item "out" without deleting it (they'll likely
  -- restock the same thing) - filtered out of generation and out of the
  -- default kitchen view, but still editable/re-enable-able.
  is_available BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kitchen_items_user_category ON kitchen_items(user_id, category);
