-- "Alternatives to discuss with your doctor" and "supplements to discuss" -
-- general, non-prescriptive talking points, never a recommendation to
-- switch or start anything. Only populated for AI-described medications
-- (medicationKnowledgeService.js's describeWithClaude): the curated
-- knowledge base (medicationKnowledgeBase.js) is hand-vetted and small, and
-- fabricating alternatives for it would need the same real clinical review
-- as the rest of that data, which is out of scope here.
ALTER TABLE medication_knowledge_cache ADD COLUMN IF NOT EXISTS alternatives_to_discuss TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE medication_knowledge_cache ADD COLUMN IF NOT EXISTS supplements_to_discuss TEXT[] NOT NULL DEFAULT '{}';
