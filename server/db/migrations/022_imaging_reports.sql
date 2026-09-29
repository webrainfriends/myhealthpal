-- Imaging/radiology reports (X-ray, CT, MRI, ultrasound, etc.) don't carry
-- discrete lab parameters - their clinically relevant content is narrative:
-- the modality/body region examined, the Findings section, the
-- Impression/Conclusion, and any explicitly stated follow-up
-- recommendations. Modeled the same way notes/alerts were added in
-- 006_report_document_metadata.sql: document-level columns on `reports`,
-- populated only by a provider capable of reading the whole document.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS modality TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS body_region TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS findings TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS impression TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS recommendations TEXT;
