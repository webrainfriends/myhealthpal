// Turns a normalized document ({ contentKind, tables, text }) into a flat list
// of candidate health parameters. This is the single format-neutral extraction
// contract every adapter (PDF/DOCX/CSV/XLSX) feeds into.

const HEADER_ALIASES = {
  test_name: ['test', 'test name', 'parameter', 'analyte', 'investigation', 'component'],
  value: ['value', 'result', 'reading', 'observed value', 'observation'],
  unit: ['unit', 'units'],
  reference_range: ['reference range', 'ref range', 'ref. range', 'normal range', 'bio. ref. range', 'range', 'biological reference interval'],
  status_flag: ['flag', 'status', 'interpretation', 'abnormal flag'],
  param_date: ['date', 'test date', 'sample date', 'collected on', 'reported on'],
};

// Values that are legitimately non-numeric health results.
const NON_NUMERIC_VALUE_PATTERN = /^(trace|positive|negative|not detected|detected|reactive|non-reactive|nil|absent|present)$/i;

const NUMERIC_VALUE_TOKEN = /^[<>]?\d+(?:\.\d+)?$/;
const NON_NUMERIC_VALUE_WORDS = [
  ['not', 'detected'],
  ['non-reactive'],
  ['reactive'],
  ['positive'],
  ['negative'],
  ['trace'],
  ['detected'],
  ['nil'],
  ['absent'],
  ['present'],
];
const UNIT_TOKEN = /^[A-Za-z%µ][A-Za-z%/µ0-9^]*$/;
const RANGE_TOKEN = /^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?$/;
const FLAG_TOKEN = /^(High|Low|Normal|Abnormal|H|L)$/i;

// Matches a value token (numeric, possibly comparator-prefixed) or a
// non-numeric clinical result phrase (e.g. "Not Detected") starting at
// `tokens[startIndex]`. Returns { value, nextIndex } or null.
function matchValueAt(tokens, startIndex) {
  const single = tokens[startIndex];
  if (single !== undefined && NUMERIC_VALUE_TOKEN.test(single)) {
    return { value: single, nextIndex: startIndex + 1 };
  }
  for (const phrase of NON_NUMERIC_VALUE_WORDS) {
    const slice = tokens.slice(startIndex, startIndex + phrase.length).map((t) => t.toLowerCase());
    if (slice.length === phrase.length && slice.join(' ') === phrase.join(' ')) {
      return { value: tokens.slice(startIndex, startIndex + phrase.length).join(' '), nextIndex: startIndex + phrase.length };
    }
  }
  return null;
}

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((rawHeader, index) => {
    const normalized = normalizeHeader(rawHeader);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(normalized) && map[field] === undefined) {
        map[field] = index;
      }
    }
  });
  return map;
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[<>]/g, '').trim().replace(',', '.');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isPlausibleValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const str = String(value).trim();
  return parseNumeric(str) !== null || NON_NUMERIC_VALUE_PATTERN.test(str);
}

function extractFromTables(tables) {
  const parameters = [];
  const warnings = [];

  for (const rows of tables) {
    if (rows.length < 2) {
      warnings.push('A sheet/table had no data rows below the header.');
      continue;
    }
    const columnMap = buildColumnMap(rows[0]);
    if (columnMap.test_name === undefined || columnMap.value === undefined) {
      warnings.push('Could not confidently identify test name/value columns in a table; skipped.');
      continue;
    }

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const testName = row[columnMap.test_name];
      const value = row[columnMap.value];
      if (!testName || !isPlausibleValue(value)) continue;

      parameters.push({
        test_name: String(testName).trim(),
        value: String(value).trim(),
        numeric_value: parseNumeric(value),
        unit: columnMap.unit !== undefined ? String(row[columnMap.unit] || '').trim() || null : null,
        reference_range:
          columnMap.reference_range !== undefined ? String(row[columnMap.reference_range] || '').trim() || null : null,
        status_flag: columnMap.status_flag !== undefined ? String(row[columnMap.status_flag] || '').trim() || null : null,
        param_date: columnMap.param_date !== undefined ? parseDate(row[columnMap.param_date]) : null,
        confidence: 0.9,
        needs_review: false,
        raw_source_text: row.join(' | '),
      });
    }
  }

  return { parameters, warnings };
}

// Parses a single "TestName  Value  Unit  Range  Flag" style line into a
// candidate parameter, tolerant of single- or multi-space separated tokens
// (PDF/DOCX text extraction rarely preserves original column alignment).
function parseTextLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  // Find the first plausible value token at or after index 1, so at least
  // one token remains available for the test name.
  let valueMatch = null;
  let valueStartIndex = -1;
  for (let i = 1; i < tokens.length; i += 1) {
    const attempt = matchValueAt(tokens, i);
    if (attempt) {
      valueMatch = attempt;
      valueStartIndex = i;
      break;
    }
  }
  if (!valueMatch) return null;

  const testName = tokens.slice(0, valueStartIndex).join(' ');
  let cursor = valueMatch.nextIndex;
  let unit = null;
  let range = null;
  let flag = null;

  if (cursor < tokens.length && UNIT_TOKEN.test(tokens[cursor]) && !FLAG_TOKEN.test(tokens[cursor])) {
    unit = tokens[cursor];
    cursor += 1;
  }
  if (cursor < tokens.length && RANGE_TOKEN.test(tokens[cursor])) {
    range = tokens[cursor];
    cursor += 1;
  } else if (cursor + 2 < tokens.length && RANGE_TOKEN.test(tokens.slice(cursor, cursor + 3).join(''))) {
    // Range split across tokens by whitespace around the dash, e.g. "12.0 - 16.0".
    range = tokens.slice(cursor, cursor + 3).join(' ');
    cursor += 3;
  }
  if (cursor < tokens.length && FLAG_TOKEN.test(tokens[cursor])) {
    flag = tokens[cursor];
    cursor += 1;
  }

  return { testName, value: valueMatch.value, unit, range, flag };
}

function extractFromText(text) {
  const parameters = [];
  const warnings = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseTextLine(line);
    if (!parsed) continue;

    parameters.push({
      test_name: parsed.testName,
      value: parsed.value,
      numeric_value: parseNumeric(parsed.value),
      unit: parsed.unit,
      reference_range: parsed.range,
      status_flag: parsed.flag,
      param_date: null,
      confidence: 0.6,
      needs_review: true,
      raw_source_text: line.trim(),
    });
  }

  if (parameters.length === 0) {
    warnings.push('No structured test/value pairs could be confidently identified in the document text.');
  }

  return { parameters, warnings };
}

function extractParameters(document) {
  if (document.contentKind === 'structured_table' && document.tables) {
    return extractFromTables(document.tables);
  }
  if (document.contentKind === 'text_native' && document.text) {
    return extractFromText(document.text);
  }
  return { parameters: [], warnings: ['Document content was not in a format that could be parsed for parameters.'] };
}

module.exports = { extractParameters };
