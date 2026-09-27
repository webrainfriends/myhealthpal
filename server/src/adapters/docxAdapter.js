const mammoth = require('mammoth');

// `input` is the decrypted file as a Buffer (the vault never writes
// plaintext to disk); a path is still accepted for tests and tools.
async function extract(input) {
  const result = await mammoth.extractRawText(Buffer.isBuffer(input) ? { buffer: input } : { path: input });
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
