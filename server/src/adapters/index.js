const csvAdapter = require('./csvAdapter');
const xlsxAdapter = require('./xlsxAdapter');
const docxAdapter = require('./docxAdapter');
const pdfAdapter = require('./pdfAdapter');
const imageAdapter = require('./imageAdapter');

// Format-neutral registry: every adapter resolves to { contentKind, tables, text }
// so the extraction service downstream never needs to know the source format.
const ADAPTERS_BY_EXTENSION = {
  csv: csvAdapter,
  xls: xlsxAdapter,
  xlsx: xlsxAdapter,
  doc: docxAdapter,
  docx: docxAdapter,
  pdf: pdfAdapter,
  jpg: imageAdapter,
  jpeg: imageAdapter,
  png: imageAdapter,
};

function getAdapter(extension) {
  return ADAPTERS_BY_EXTENSION[extension.toLowerCase()] || null;
}

module.exports = { getAdapter };
