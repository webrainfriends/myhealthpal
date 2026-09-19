const fs = require('fs');
const { parse } = require('csv-parse/sync');

async function extract(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
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
