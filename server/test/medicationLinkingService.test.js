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

test('findKnowledgeEntry gives a drug-specific answer, never a "depending on the product" grouped one', () => {
  // Regression test: these used to share one combined "paracetamol"/
  // "azithromycin"/"omeprazole" entry whose activeIngredient text listed
  // several unrelated drugs and said "depending on the specific product" -
  // correct for nothing. Manually typing just the drug name (no scan, no
  // generic_name filled in) must resolve to that exact drug's own entry.
  const cases = [
    { name: 'Paracetamol', expectedId: 'paracetamol', expectedIngredient: 'Paracetamol (acetaminophen)' },
    { name: 'Ibuprofen', expectedId: 'ibuprofen', expectedIngredient: 'Ibuprofen' },
    { name: 'Azithromycin', expectedId: 'azithromycin', expectedIngredient: 'Azithromycin' },
    { name: 'Doxycycline', expectedId: 'doxycycline', expectedIngredient: 'Doxycycline' },
    { name: 'Omeprazole', expectedId: 'omeprazole', expectedIngredient: 'Omeprazole' },
  ];
  for (const { name, expectedId, expectedIngredient } of cases) {
    const entry = findKnowledgeEntry({ name, generic_name: null, brand_name: null });
    assert.ok(entry, `expected a match for "${name}"`);
    assert.equal(entry.id, expectedId);
    assert.equal(entry.activeIngredient, expectedIngredient);
    assert.doesNotMatch(entry.activeIngredient, /depending on the specific product/i);
  }
});

test('a combination product (Augmentin) names both of its active ingredients', () => {
  const entry = findKnowledgeEntry({ name: 'Augmentin 625', generic_name: null, brand_name: null });
  assert.ok(entry);
  assert.equal(entry.id, 'amoxicillin');
  assert.match(entry.activeIngredient, /Amoxicillin/);
  assert.match(entry.activeIngredient, /Clavulanic acid/);
});
