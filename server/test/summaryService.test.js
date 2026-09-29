const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSummary, generateImagingSummary } = require('../src/services/summaryService');

test('generateSummary still reports "no parameters" for an empty lab report', () => {
  assert.match(generateSummary([]), /No health parameters could be automatically extracted/);
});

test('generateImagingSummary names the modality and body region when both are known', () => {
  const summary = generateImagingSummary({
    modality: 'CT',
    bodyRegion: 'Chest',
    findings: 'No acute abnormality.',
    impression: 'Normal chest CT.',
    recommendations: null,
  });
  assert.match(summary, /^CT — Chest report processed\./);
  assert.match(summary, /See Impression and Findings below/);
});

test('generateImagingSummary falls back to a generic label with no modality/body region', () => {
  const summary = generateImagingSummary({ findings: 'Mild degenerative changes.' });
  assert.match(summary, /^Imaging study report processed\./);
  assert.match(summary, /See Findings below/);
});

test('generateImagingSummary flags when nothing could be extracted', () => {
  const summary = generateImagingSummary({ modality: 'X-Ray' });
  assert.match(summary, /No findings or impression text could be automatically extracted/);
});

test('generateImagingSummary mentions a recommendation when present', () => {
  const summary = generateImagingSummary({
    modality: 'MRI',
    impression: 'Small meniscal tear.',
    recommendations: 'Orthopedic follow-up recommended.',
  });
  assert.match(summary, /A follow-up recommendation was noted/);
});
