const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const { createCanvas } = require('@napi-rs/canvas');
const pdfAdapter = require('../src/adapters/pdfAdapter');

function writePdf(filePath, buildFn) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument();
    const out = fs.createWriteStream(filePath);
    pdf.pipe(out);
    buildFn(pdf);
    pdf.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function samplePngBuffer() {
  const canvas = createCanvas(200, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = 'black';
  ctx.fillRect(10, 10, 60, 20);
  return canvas.toBuffer('image/png');
}

test('a scanned (image-only, no selectable text) PDF is rendered to page images', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfadapter-test-'));
  const filePath = path.join(dir, 'scan.pdf');
  const image = samplePngBuffer();

  await writePdf(filePath, (pdf) => {
    pdf.image(image, 0, 0, { width: pdf.page.width });
    pdf.addPage();
    pdf.image(image, 0, 0, { width: pdf.page.width });
  });

  const doc = await pdfAdapter.extract(filePath);

  assert.equal(doc.contentKind, 'image_scanned');
  assert.equal(doc.text, null);
  assert.equal(doc.pageCount, 2);
  assert.equal(doc.images.length, 2);
  for (const [index, img] of doc.images.entries()) {
    assert.equal(img.pageNumber, index + 1);
    assert.equal(img.mediaType, 'image/jpeg');
    assert.ok(typeof img.base64 === 'string' && img.base64.length > 0);
    // A JPEG file always starts with the FF D8 FF SOI marker.
    const decoded = Buffer.from(img.base64, 'base64');
    assert.equal(decoded[0], 0xff);
    assert.equal(decoded[1], 0xd8);
    assert.equal(decoded[2], 0xff);
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a text-native PDF is not rasterized (no images field needed)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfadapter-test-'));
  const filePath = path.join(dir, 'text.pdf');

  await writePdf(filePath, (pdf) => {
    pdf.fontSize(11).font('Courier');
    pdf.text('Hemoglobin       13.8   g/dL    12.0-16.0   Normal');
    pdf.text('Sodium           142    mmol/L  135-145     Normal');
  });

  const doc = await pdfAdapter.extract(filePath);

  assert.equal(doc.contentKind, 'text_native');
  assert.ok(doc.text.includes('Hemoglobin'));
  assert.equal(doc.images, undefined);

  fs.rmSync(dir, { recursive: true, force: true });
});
