-- Adds "tonic" and "lotion" as first-class dosage forms (previously only
-- reachable via 'other'), and a place to keep the ingredient/composition
-- list exactly as printed on a scanned label - never invented, and kept
-- separate from the curated knowledge base's general activeIngredient text
-- (which describes the drug generically, not the specific product's label).

ALTER TABLE medications DROP CONSTRAINT medications_form_check;
ALTER TABLE medications ADD CONSTRAINT medications_form_check
  CHECK (form IN ('tablet', 'capsule', 'syrup', 'tonic', 'injection', 'drops', 'lotion', 'inhaler', 'cream', 'other'));

ALTER TABLE medications ADD COLUMN IF NOT EXISTS ingredients_raw TEXT;
