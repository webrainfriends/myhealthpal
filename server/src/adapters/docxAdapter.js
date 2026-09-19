const mammoth = require('mammoth');

async function extract(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = (result.value || '').trim();
  if (!text) {
    throw new Error('Document contains no extractable text');
  }
  return {
    contentKind: 'text_native',
    tables: null,
    text,
  };
}

module.exports = { extract };
