-- My Insurance: an uploaded policy document (any format the report pipeline
-- reads) is extracted into a policy row plus organ-wise coverage items, so
-- the app can tag lab results as covered / not covered, remind about
-- premiums and renewal, and flag coverage gaps that new lab findings raise.
-- Only ciphertext of the original document is stored (same vault columns as
-- reports, medication_scans and diet_scans - see 022_secure_vault.sql).
CREATE TABLE IF NOT EXISTS insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  original_filename TEXT NOT NULL,
  mime_type TEXT,
  file_extension TEXT NOT NULL,
  file_size_bytes BIGINT,
  storage_path TEXT,
  encryption_version INTEGER,
  cipher_algorithm TEXT,
  storage_object_key TEXT,
  encrypted_data_key BYTEA,
  key_provider TEXT,
  key_reference TEXT,
  key_version TEXT,
  cipher_iv BYTEA,
  cipher_auth_tag BYTEA,
  ciphertext_sha256 TEXT,
  encrypted_at TIMESTAMPTZ,
  legacy_migration_status TEXT,

  -- 'Processing' -> 'Needs Review' (extracted, awaiting the user's check) ->
  -- 'Completed' (confirmed; only these drive tags, gaps and reminders).
  ingestion_status TEXT NOT NULL DEFAULT 'Uploaded'
    CHECK (ingestion_status IN ('Uploaded', 'Processing', 'Needs Review', 'Completed', 'Failed')),
  processing_error TEXT,
  raw_model_output JSONB,
  confirmed_at TIMESTAMPTZ,

  -- Policy
  provider_name TEXT,
  plan_name TEXT,
  policy_number TEXT,
  policy_type TEXT,
  policyholder_name TEXT,
  insured_members TEXT,
  sum_insured NUMERIC,
  currency TEXT,
  policy_start_date DATE,
  policy_end_date DATE,
  initial_waiting_days INTEGER,
  preexisting_waiting_months INTEGER,

  -- Premium
  premium_amount NUMERIC,
  premium_frequency TEXT CHECK (premium_frequency IS NULL OR premium_frequency IN ('monthly', 'quarterly', 'half_yearly', 'annual', 'single')),
  next_premium_due_date DATE,
  grace_period_days INTEGER,

  -- Contacts
  provider_phone TEXT,
  provider_email TEXT,
  provider_website TEXT,
  claims_phone TEXT,
  claims_email TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  agent_email TEXT,
  support_phone TEXT,
  support_email TEXT,
  tpa_name TEXT,
  tpa_phone TEXT,
  other_contacts JSONB,

  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_policies_user ON insurance_policies(user_id, ingestion_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_policies_storage_object_key
  ON insurance_policies (storage_object_key) WHERE storage_object_key IS NOT NULL;

-- One row per illness / procedure / organ-level clause. `organ_key` uses the
-- insurance organ taxonomy in server/src/insurance/insuranceRules.js (which
-- maps onto the dashboard's organ cards); 'general' holds policy-wide
-- clauses such as general exclusions.
CREATE TABLE IF NOT EXISTS insurance_coverage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  organ_key TEXT NOT NULL,
  condition_name TEXT NOT NULL,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('covered', 'partial', 'excluded')),
  ceiling_amount NUMERIC,
  ceiling_basis TEXT,
  copay_percent NUMERIC,
  copay_amount NUMERIC,
  deductible_amount NUMERIC,
  waiting_period_months INTEGER,
  sub_limit_note TEXT,
  clause_reference TEXT,
  clause_text TEXT,
  confidence NUMERIC,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_items_policy ON insurance_coverage_items(policy_id, organ_key);

-- Each premium / renewal reminder is sent at most once per policy, kind and
-- period (the due date), so the reminder job can run hourly without repeats.
CREATE TABLE IF NOT EXISTS insurance_reminders_sent (
  policy_id UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  period DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, kind, period)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS insurance_reminders_enabled BOOLEAN NOT NULL DEFAULT true;

-- Smart upload (routes/smartUpload.js) files a document as a diet schedule
-- without asking for a duration up front: the import then sizes the schedule
-- to what the document actually contains (7 days if it fits, else 15).
ALTER TABLE diet_schedule_imports ADD COLUMN IF NOT EXISTS duration_auto BOOLEAN NOT NULL DEFAULT false;
