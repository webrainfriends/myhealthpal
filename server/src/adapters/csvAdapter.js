const fs = require('fs');
const { parse } = require('csv-parse/sync');

// `input` is the decrypted file as a Buffer (the vault never writes
// plaintext to disk); a path is still accepted for tests and tools.
async function extract(input) {
  const raw = Buffer.isBuffer(input) ? input.toString('utf8') : fs.readFileSync(input, 'utf8');
  const rows = parse(raw, {
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });
  if (rows.length === 0) {
    throw new Error('CSV file contains no rows');
  }
  return {
    contentKind: 'structured_table',
    tables: [rows],
    text: null,
  };
}

module.exports = { extract };
