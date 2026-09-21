// Generates one sample file per supported format under test-fixtures/, for
// manually exercising the ingestion pipeline (npm run fixtures) without
// needing real patient data.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph } = require('docx');
const PDFDocument = require('pdfkit');

const OUT_DIR = path.join(__dirname, '..', 'test-fixtures');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const csv = [
    'Test,Result,Unit,Reference Range,Flag,Date',
    'Hemoglobin,13.5,g/dL,12.0-16.0,Normal,2026-09-01',
    'WBC Count,11.2,10^3/uL,4.0-11.0,High,2026-09-01',
    'Glucose Fasting,<5,mg/dL,70-100,Low,2026-09-01',
    'HBsAg,Not Detected,,,Normal,2026-09-01',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'sample_report.csv'), csv);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');
  sheet.addRow(['Test', 'Result', 'Unit', 'Reference Range', 'Flag', 'Date']);
  sheet.addRow(['Total Cholesterol', 210, 'mg/dL', '125-200', 'High', '2026-09-02']);
  sheet.addRow(['HDL Cholesterol', 55, 'mg/dL', '40-60', 'Normal', '2026-09-02']);
  sheet.addRow(['Vitamin D', 18.4, 'ng/mL', '30-100', 'Low', '2026-09-02']);
  await workbook.xlsx.writeFile(path.join(OUT_DIR, 'sample_report.xlsx'));

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph('Acme Diagnostics Lab Report'),
          new Paragraph('Patient: Jane Doe   Date: 2026-09-05'),
          new Paragraph(' '),
          new Paragraph('Hemoglobin       13.1   g/dL    12.0-16.0   Normal'),
          new Paragraph('Platelet Count   450    10^3/uL 150-410     High'),
          new Paragraph('Creatinine       0.9    mg/dL   0.6-1.3     Normal'),
        ],
      },
    ],
  });
  fs.writeFileSync(path.join(OUT_DIR, 'sample_report.docx'), await Packer.toBuffer(doc));

  await new Promise((resolve, reject) => {
    const pdf = new PDFDocument();
    const out = fs.createWriteStream(path.join(OUT_DIR, 'sample_report.pdf'));
    pdf.pipe(out);
    pdf.fontSize(14).text('Acme Diagnostics Lab Report');
    pdf.moveDown();
    pdf.fontSize(11).font('Courier');
    pdf.text('Patient: Jane Doe  Date: 2026-09-06');
    pdf.moveDown();
    pdf.text('Hemoglobin       13.8   g/dL    12.0-16.0   Normal');
    pdf.text('Sodium           142    mmol/L  135-145     Normal');
    pdf.text('Potassium        5.6    mmol/L  3.5-5.1     High');
    pdf.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });

  // Tiny valid PNG, to exercise the scanned-image (OCR/needs-review) path.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  fs.writeFileSync(path.join(OUT_DIR, 'sample_scan.png'), Buffer.from(pngBase64, 'base64'));

  // A PDF with no selectable text at all (image-only page) - to exercise the
  // scanned-PDF rasterization path (pdfAdapter renders it to page images for
  // a vision-capable provider instead of leaving it unreadable).
  await new Promise((resolve, reject) => {
    const scannedPdf = new PDFDocument();
    const out = fs.createWriteStream(path.join(OUT_DIR, 'sample_scan.pdf'));
    scannedPdf.pipe(out);
    scannedPdf.image(Buffer.from(pngBase64, 'base64'), 0, 0, { width: scannedPdf.page.width });
    scannedPdf.end();
    out.on('finish', resolve);
    out.on('error', reject);
  });

  // Corrupt file, to exercise the validation/failure path.
  fs.writeFileSync(path.join(OUT_DIR, 'corrupt.pdf'), 'this is not a real pdf file');

  console.log(`fixtures written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
