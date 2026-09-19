const test = require('node:test');
const assert = require('node:assert/strict');
const { checkForEmergency } = require('../src/chat/safetyPreCheck');

test('flags common emergency phrasing', () => {
  for (const message of [
    'I have severe chest pain right now',
    "I can't breathe",
    'I feel like I might hurt myself',
    'my face is drooping and speech is slurred',
  ]) {
    const result = checkForEmergency(message);
    assert.equal(result.isEmergency, true, `expected emergency for: ${message}`);
    assert.match(result.response, /emergency|988/i);
  }
});

test('does not flag ordinary health questions', () => {
  for (const message of [
    'What was my latest HbA1c?',
    'Show my weight trend for the last 6 months',
    'Why was my cholesterol flagged?',
  ]) {
    assert.equal(checkForEmergency(message).isEmergency, false, `did not expect emergency for: ${message}`);
  }
});
