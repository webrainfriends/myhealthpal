-- Many health plans (e.g. Singapore Integrated Shield plans) have no fixed
-- term: they are guaranteed to renew every year on the policy anniversary.
-- For those, the "cover period" is the current 12-month policy year, which
-- rolls forward each anniversary rather than ending on a single stored date.
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS renews_annually BOOLEAN NOT NULL DEFAULT false;
