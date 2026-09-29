-- Alternative medicine system support (Ayurveda, Unani, Siddha, Homeopathy)
-- alongside the existing allopathic-only medication model, plus a place to
-- store an authentic, government-backed source URL on a reference range so
-- the Medications and AI Insights pages can link out to read more - see
-- server/src/medications/citationSources.js for the curated list of real
-- URLs this gets populated from (never a free-text-only citation going
-- forward, and never a fabricated link).

ALTER TABLE medications ADD COLUMN IF NOT EXISTS medicine_system TEXT NOT NULL DEFAULT 'allopathic'
  CHECK (medicine_system IN ('allopathic', 'ayurvedic', 'homeopathic', 'unani', 'siddha'));

-- citation (migration 008) stays the free-text description of the standard/
-- guideline behind a range; source_url is the clickable link to the issuing
-- body's own page. Nullable because it's backfilled by re-running
-- `npm run seed` (server/db/reference-range-seed-data.js), not by this
-- migration itself.
ALTER TABLE reference_ranges ADD COLUMN IF NOT EXISTS source_url TEXT;
