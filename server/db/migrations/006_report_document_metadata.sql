-- Document-level fields an extraction provider can read off the report
-- itself (as opposed to a single test result): free-text remarks (e.g.
-- fasting status, specimen condition) and any critical/panic-value or other
-- alert text printed in the report. source_provider (lab/facility name) and
-- report_type (panel/test description) already existed since 001_init.sql
-- but were never populated - only a provider capable of reading the whole
-- document (not just tabular results) can fill any of these in.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS alerts TEXT;
