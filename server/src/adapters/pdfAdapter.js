const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const { createCanvas } = require('@napi-rs/canvas');

const STANDARD_FONT_DATA_URL = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
);

const MIN_CHARS_PER_PAGE_FOR_TEXT_NATIVE = 20;
const LINE_Y_TOLERANCE = 2;

// A scanned/photographed report (no selectable text) is handed to a
// vision-capable extraction provider as page images instead. ~150 DPI is
// enough to keep small print legible while keeping the per-page payload
// reasonable; PDF page dimensions are in points (72/inch).
const RENDER_DPI = 150;
const RENDER_SCALE = RENDER_DPI / 72;
const JPEG_QUALITY = 85;
// Caps both API payload size and cost; a report longer than this is rare,
// and the ingestion job still succeeds (with the extra pages simply
// unextracted) rather than failing outright.
const MAX_RENDERED_PAGES = 20;

async function renderPagesToImages(doc) {
  const images = [];
  const pageCount = Math.min(doc.numPages, MAX_RENDERED_PAGES);
  for (let i = 1; i <= pageCount; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);
    // eslint-disable-next-line no-await-in-loop
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push({
      pageNumber: i,
      mediaType: 'image/jpeg',
      base64: canvas.toBuffer('image/jpeg', JPEG_QUALITY).toString('base64'),
    });
  }
  return images;
}

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
    // Render each page to an image so a vision-capable provider can still
    // read it; a provider with no vision support just ignores `images`.
    const images = await renderPagesToImages(doc);
    return {
      contentKind: 'image_scanned',
      tables: null,
      text: null,
      images,
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
