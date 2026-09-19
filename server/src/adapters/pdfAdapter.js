const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const STANDARD_FONT_DATA_URL = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
);

const MIN_CHARS_PER_PAGE_FOR_TEXT_NATIVE = 20;
const LINE_Y_TOLERANCE = 2;

// pdf.js returns text runs, not lines; group runs whose baseline (transform[5])
// falls within a small tolerance of each other into the same line so
// downstream line-based parsing (parameterExtractor) sees rows as authored.
function itemsToLines(items) {
  const lines = [];
  let currentY = null;
  let currentLine = [];

  for (const item of items) {
    const y = item.transform[5];
    if (currentY === null || Math.abs(y - currentY) > LINE_Y_TOLERANCE) {
      if (currentLine.length > 0) lines.push(currentLine.join(''));
      currentLine = [];
      currentY = y;
    }
    currentLine.push(item.str);
    if (item.hasEOL) {
      lines.push(currentLine.join(''));
      currentLine = [];
      currentY = null;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine.join(''));

  return lines.join('\n');
}

async function extract(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));

  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise;
  } catch (err) {
    if (err instanceof pdfjsLib.PasswordException) {
      throw new Error('PDF is password-protected and cannot be processed. Please upload an unlocked copy.');
    }
    throw new Error(`Unable to read PDF: ${err.message}`);
  }

  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += `${itemsToLines(content.items)}\n`;
  }
  text = text.trim();

  const charsPerPage = text.length / doc.numPages;

  if (charsPerPage < MIN_CHARS_PER_PAGE_FOR_TEXT_NATIVE) {
    // Little to no selectable text -> this is a scanned/image-based PDF.
    return {
      contentKind: 'image_scanned',
      tables: null,
      text: null,
      pageCount: doc.numPages,
    };
  }

  return {
    contentKind: 'text_native',
    tables: null,
    text,
    pageCount: doc.numPages,
  };
}

module.exports = { extract };
