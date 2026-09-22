-- A confirmed lab result whose test name never matched anything in the
-- Health Parameter Registry (health_measurements.health_parameter_id IS
-- NULL) previously never appeared on the Dashboard at all - /api/dashboard/
-- organs only ever joins health_parameters, so it was silently dropped from
-- every organ card. This table lets customCardService group those
-- unmapped test names into ad-hoc dashboard cards instead (AI-assisted,
-- with a deterministic heuristic fallback - see customCardService.js),
-- cached here so the same test name is only classified once.
--
-- Global (no user_id): a test name like "A/G Ratio" or "Ferritin" means the
-- same thing for every user, exactly like health_parameters/
-- parameter_aliases already are - nothing patient-specific is stored here,
-- only a label for a *kind* of test.
CREATE TABLE IF NOT EXISTS custom_parameter_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name_key TEXT UNIQUE NOT NULL,
  group_label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🔬',
  source TEXT NOT NULL DEFAULT 'heuristic' CHECK (source IN ('ai', 'heuristic')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
