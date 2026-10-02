const test = require('node:test');
const assert = require('node:assert/strict');
const { reportDisplayTitle } = require('../src/lib/reportTitle');

test('title is built from type, lab and date, never the random filename', () => {
  assert.equal(
    reportDisplayTitle({ original_filename: 'a3f9c2e1.pdf', report_type: 'complete blood count', source_provider: 'Apollo Diagnostics', effective_date: '2025-08-31' }),
    'Complete Blood Count · Apollo Diagnostics · 2025-08-31'
  );
  assert.equal(reportDisplayTitle({ original_filename: 'x9.pdf', effective_date: new Date('2025-08-31T00:00:00Z') }), 'Health report · 2025-08-31');
});

test('imaging reports use modality and body region', () => {
  assert.equal(reportDisplayTitle({ modality: 'x-ray', body_region: 'chest', effective_date: '2025-01-02' }), 'X-Ray - Chest · 2025-01-02');
});

test('a glucose export is named as such, and a missing row is safe', () => {
  assert.equal(reportDisplayTitle({ source_type: 'glucose_export' }), 'Glucose meter readings');
  assert.equal(reportDisplayTitle(null), 'Health report');
});
