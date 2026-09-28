-- Delete-account feature: every other FK to users(id) already cascades or
-- sets null on delete except this one. corrected_by identifies who made an
-- edit to someone else's measurement (e.g. a caregiver correcting a managed
-- profile's data) - deleting that actor's account should not block deleting
-- the account, nor should it erase the correction record itself. Same
-- "keep the history, drop who did it" pattern as ai_usage_events.user_id
-- and user_consents.granted_by_user_id.
ALTER TABLE measurement_corrections ALTER COLUMN corrected_by DROP NOT NULL;
ALTER TABLE measurement_corrections DROP CONSTRAINT measurement_corrections_corrected_by_fkey;
ALTER TABLE measurement_corrections ADD CONSTRAINT measurement_corrections_corrected_by_fkey
  FOREIGN KEY (corrected_by) REFERENCES users(id) ON DELETE SET NULL;
