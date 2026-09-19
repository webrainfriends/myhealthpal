// Scans and photographs (JPEG/PNG) always require OCR/document-vision processing.
// The actual OCR/vision call is a pluggable dependency (e.g. a cloud document-AI
// API) that isn't wired up in this environment; extract() reports the document
// as image_scanned with no text so the ingestion pipeline routes it to
// "Needs Review" instead of silently fabricating results.

async function extract() {
  return {
    contentKind: 'image_scanned',
    tables: null,
    text: null,
  };
}

module.exports = { extract };
