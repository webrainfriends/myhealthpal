const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContent } = require('../src/extraction/providers/claudeProvider');

test('builds one image block per rendered page for a scanned PDF, in page order', () => {
  const document = {
    contentKind: 'image_scanned',
    images: [
      { pageNumber: 1, mediaType: 'image/jpeg', base64: 'AAA' },
      { pageNumber: 2, mediaType: 'image/jpeg', base64: 'BBB' },
      { pageNumber: 3, mediaType: 'image/jpeg', base64: 'CCC' },
    ],
  };

  const content = buildContent(document, {});

  assert.equal(content.length, 4); // 3 images + trailing instruction text
  assert.deepEqual(
    content.slice(0, 3).map((b) => b.type),
    ['image', 'image', 'image']
  );
  assert.deepEqual(
    content.slice(0, 3).map((b) => b.source.data),
    ['AAA', 'BBB', 'CCC']
  );
  assert.equal(content[3].type, 'text');
});

test('still sends a standalone photo upload (jpg/png) as a single image', () => {
  const document = { contentKind: 'image_scanned' };
  const content = buildContent(document, { filePath: __filename, mimeType: 'image/jpeg' });

  assert.equal(content.length, 2);
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[1].type, 'text');
});

test('returns null when a scanned PDF has no rendered pages and no image file to fall back on', () => {
  const document = { contentKind: 'image_scanned', images: [] };
  assert.equal(buildContent(document, {}), null);
});

test('text-native and structured-table documents are unaffected', () => {
  const textDoc = { contentKind: 'text_native', text: 'Hemoglobin 13.8 g/dL' };
  const textContent = buildContent(textDoc, {});
  assert.equal(textContent.length, 1);
  assert.ok(textContent[0].text.includes('Hemoglobin'));

  const tableDoc = { contentKind: 'structured_table', tables: [[['Test', 'Result'], ['Hemoglobin', '13.8']]] };
  const tableContent = buildContent(tableDoc, {});
  assert.equal(tableContent.length, 1);
  assert.ok(tableContent[0].text.includes('Hemoglobin'));
});
