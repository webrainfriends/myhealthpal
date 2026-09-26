const ExcelJS = require('exceljs');

function flattenCellValue(cell) {
  const { value } = cell;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (value.result !== undefined) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
  }
  return value;
}

// `input` is the decrypted file as a Buffer (the vault never writes
// plaintext to disk); a path is still accepted for tests and tools.
async function extract(input) {
  const workbook = new ExcelJS.Workbook();
  if (Buffer.isBuffer(input)) await workbook.xlsx.load(input);
  else await workbook.xlsx.readFile(input);

  if (workbook.worksheets.length === 0) {
    throw new Error('Spreadsheet contains no sheets');
  }

  const tables = workbook.worksheets
    .map((sheet) => {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values.slice(1).map((_, idx) => flattenCellValue(row.getCell(idx + 1)));
        if (values.some((v) => v !== '' && v !== null && v !== undefined)) {
          rows.push(values);
        }
      });
      return rows;
    })
    .filter((rows) => rows.length > 0);

  if (tables.length === 0) {
    throw new Error('Spreadsheet has no readable data rows');
  }

  return {
    contentKind: 'structured_table',
    tables,
    text: null,
  };
}

module.exports = { extract };
