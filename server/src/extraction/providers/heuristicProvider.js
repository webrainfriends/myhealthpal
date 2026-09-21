const { extractParameters } = require('../../services/parameterExtractor');

// Local, deterministic provider: no external API calls. This is the existing
// table-header/tokenized-line parser from the ingestion pipeline, wrapped to
// satisfy the same provider contract as any LLM-backed provider.
async function extract(document) {
  const { parameters, warnings } = extractParameters(document);
  // Report-level fields (lab name, panel type, notes, alerts) require
  // reading the whole document, not just tokenizing result lines - only a
  // model-backed provider can fill these in.
  // Never has vision support - an image_scanned document always stays
  // unextracted (OCR Pending) under this provider.
  return { candidates: parameters, warnings, rawModelOutput: null, document: null, ocrAttempted: false };
}

module.exports = { name: 'heuristic', extract };
