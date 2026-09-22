-- Tracks whether a food_entries row's current nutrition values are exactly
-- what an AI estimate produced (photo scan or dietTextProvider.js's typed
-- estimate) and haven't been touched since - as opposed to a person having
-- typed/overridden any of the numbers themselves. Drives the mobile app's
-- "AI verified" badge (FoodEntryCard.jsx): a signal of provenance, not of
-- correctness - a person can always edit an AI-sourced value, at which
-- point this flips back to false (see routes/diet.js's PATCH /entries/:id).

ALTER TABLE food_entries
  ADD COLUMN IF NOT EXISTS ai_verified BOOLEAN NOT NULL DEFAULT false;
