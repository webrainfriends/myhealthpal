-- "First recorded <test>" insights (insight_type 'new_result') fired for
-- every parameter's first result, normal or not, flooding AI Insights with
-- items that weren't insights at all. The rule is gone (see
-- src/insights/insightRules.js); a first result now only produces an
-- insight when it's out of range. Retire the ones already published.
UPDATE insights
SET lifecycle_state = 'dismissed', updated_at = now()
WHERE insight_type = 'new_result' AND lifecycle_state = 'active';
