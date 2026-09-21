const test = require('node:test');
const assert = require('node:assert/strict');
const { findKnowledgeEntry } = require('../src/medications/medicationLinkingService');

test('findKnowledgeEntry matches by generic name', () => {
  const entry = findKnowledgeEntry({ name: 'Metformin 500mg', generic_name: 'Metformin', brand_name: null });
  assert.ok(entry);
  assert.equal(entry.id, 'metformin');
});

test('findKnowledgeEntry matches by brand name alone', () => {
  const entry = findKnowledgeEntry({ name: 'Glucophage', generic_name: null, brand_name: null });
  assert.ok(entry);
  assert.equal(entry.id, 'metformin');
});

test('findKnowledgeEntry returns null for an unrecognized medication', () => {
  const entry = findKnowledgeEntry({ name: 'Some Unlisted Drug XYZ', generic_name: null, brand_name: null });
  assert.equal(entry, null);
});

test('findKnowledgeEntry returns null with no name fields at all', () => {
  assert.equal(findKnowledgeEntry({}), null);
});
