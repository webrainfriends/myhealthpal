const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContent, MEAL_TYPES } = require('../src/extraction/providers/dietScheduleExtractionProvider');

// buildContent is a pure function (see claudeProvider.test.js for the same
// style against the report-extraction provider it was copied from) - the
// live extract() call needs a real Anthropic API key, so only the
// content-branching logic is unit-tested here.

test('meal types cover the same five slots food_entries/diet_schedule_entries use', () => {
  assert.deepEqual(MEAL_TYPES, ['breakfast', 'lunch', 'snack', 'dinner', 'supper']);
});

test('text-native and structured-table documents include the instruction and the source content', () => {
  const instruction = 'INSTRUCTION';
  const textContent = buildContent({ contentKind: 'text_native', text: 'Day 1: Idli' }, {}, instruction);
  assert.equal(textContent.length, 1);
  assert.ok(textContent[0].text.includes('INSTRUCTION'));
  assert.ok(textContent[0].text.includes('Idli'));

  const tableContent = buildContent(
    { contentKind: 'structured_table', tables: [[['Day', 'Meal', 'Dish'], ['1', 'Breakfast', 'Idli']]] },
    {},
    instruction
  );
  assert.equal(tableContent.length, 1);
  assert.ok(tableContent[0].text.includes('Idli'));
});

test('a multi-page scanned document sends one image block per page plus the instruction', () => {
  const document = {
    contentKind: 'image_scanned',
    images: [
      { mediaType: 'image/jpeg', base64: 'AAA' },
      { mediaType: 'image/jpeg', base64: 'BBB' },
    ],
  };
  const content = buildContent(document, {}, 'INSTRUCTION');
  assert.equal(content.length, 3);
  assert.deepEqual(content.slice(0, 2).map((b) => b.type), ['image', 'image']);
  assert.equal(content[2].type, 'text');
});

test('a single uploaded photo falls back to the raw file buffer, the same vision path lab-report photos already use', () => {
  const document = { contentKind: 'image_scanned' };
  const content = buildContent(document, { fileBuffer: Buffer.from('fake-image-bytes'), mimeType: 'image/png' }, 'INSTRUCTION');
  assert.equal(content.length, 2);
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/png');
  assert.equal(content[1].type, 'text');
});

test('returns null when there is no text, table, or image to read', () => {
  assert.equal(buildContent({ contentKind: 'image_scanned', images: [] }, {}, 'INSTRUCTION'), null);
});
