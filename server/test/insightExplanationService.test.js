const test = require('node:test');
const assert = require('node:assert/strict');
const { explanationOnlyReferencesEvidenceNumbers, buildHeuristicExplanation } = require('../src/insights/insightExplanationService');

test('accepts phrasing that only uses evidence numbers, in any rounding', () => {
  const data = { currentValue: 140, previousValue: 100, pctChange: 40 };
  assert.ok(explanationOnlyReferencesEvidenceNumbers('Your value rose from 100 to 140, a 40% increase.', data));
  assert.ok(explanationOnlyReferencesEvidenceNumbers('Your value rose from 100.0 to 140.00.', data));
});

test('rejects a hallucinated number not present in evidence', () => {
  const data = { currentValue: 140, previousValue: 100, pctChange: 40 };
  assert.equal(
    explanationOnlyReferencesEvidenceNumbers('Your value rose from 100 to 140, roughly double what is typical at 250.', data),
    false
  );
});

test('heuristic explanation always references only its own template numbers', () => {
  const candidate = {
    type: 'change_from_previous',
    severity: 'attention',
    templateData: {
      parameterName: 'Glucose (Fasting)',
      previousValue: 90,
      currentValue: 130,
      unit: 'mg/dL',
      pctChange: 44,
      direction: 'higher',
      qualitative: false,
    },
  };
  const text = buildHeuristicExplanation(candidate);
  assert.ok(explanationOnlyReferencesEvidenceNumbers(text, candidate.templateData));
  assert.match(text, /clinician|professional/i);
});
