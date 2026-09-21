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
// Allows units that start with a digit (e.g. "10^3/uL", "10^9/L") while still
// requiring at least one unit-like character, so a bare number or the first
// half of a "12.0 - 16.0" range never gets misread as a unit.
const UNIT_TOKEN = /^(?=.*[A-Za-z%µ^])[A-Za-z%/µ0-9^.]+$/;
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

// Columns that are patient/record metadata or free-text context in a
// "wide" export (one row per reading, one column per metric - common for
// health-tracker/wearable/glucometer apps), never a measurement themselves.
const WIDE_FORMAT_SKIP_COLUMNS = new Set([
  'medical record id',
  'medical record email',
  'name',
  'patient',
  'patient name',
  'gender',
  'sex',
  'date of birth',
  'id',
  'note',
  'notes',
  'comment',
  'comments',
  'source',
  'client',
  'app',
  'device',
  'feeling',
  'meal',
]);

// A "long" table (one row per test) is the common lab-report shape
// extractFromTables' header matching above expects, but a personal
// health-tracker export (glucometer/wearable app) is usually "wide"
// instead: one row per reading, with the metric itself as a column header
// (e.g. "Glucose") and its own paired "<Metric> Units" column, rather than
// a shared "test name"/"value" pair of columns. Detected as a fallback,
// only once the long-format column mapping above has already failed.
function extractFromWideTable(rows) {
  const rawHeader = rows[0];
  const header = rawHeader.map((h) => normalizeHeader(h));
  // A per-reading timestamp column, never a static demographic field like
  // "Date of Birth" - a header naming the reading's own date/time (e.g.
  // "Date & Time (Local Time)") is preferred over any column that merely
  // contains "date", since a wide export commonly has both and the
  // demographic one is very often listed first.
  const isBirthDateHeader = (h) => h.includes('birth') || h === 'dob';
  let dateColIndex = header.findIndex((h) => h.includes('time') && !isBirthDateHeader(h));
  if (dateColIndex === -1) {
    dateColIndex = header.findIndex((h) => h.includes('date') && !isBirthDateHeader(h));
  }

  const metricColumns = [];
  header.forEach((h, index) => {
    if (!h || index === dateColIndex) return;
    if (WIDE_FORMAT_SKIP_COLUMNS.has(h) || h.endsWith(' units') || h.endsWith(' unit')) return;
    // parseFloat lenient-parses the leading digits of a date-like string
    // (e.g. "2026-09-21" -> 2026), so require the *whole* cell to look like
    // a number, not just its prefix.
    const hasNumericValue = rows.slice(1).some((row) => {
      const cell = row[index];
      return cell !== null && cell !== undefined && String(cell).trim() !== '' && parseNumeric(cell) !== null;
    });
    if (!hasNumericValue) return;
    const unitColIndex = header.findIndex((h2) => h2 === `${h} units` || h2 === `${h} unit`);
    metricColumns.push({ index, name: String(rawHeader[index]).trim(), unitColIndex });
  });
  if (metricColumns.length === 0) return null;

  const parameters = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    for (const col of metricColumns) {
      const value = row[col.index];
      if (!isPlausibleValue(value)) continue;
      parameters.push({
        test_name: col.name,
        value: String(value).trim(),
        numeric_value: parseNumeric(value),
        unit: col.unitColIndex >= 0 ? String(row[col.unitColIndex] || '').trim() || null : null,
        reference_range: null,
        status_flag: null,
        param_date: dateColIndex >= 0 ? parseDate(row[dateColIndex]) : null,
        confidence: 0.8,
        needs_review: false,
        raw_source_text: row.join(' | '),
      });
    }
  }
  return { parameters };
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
      const wide = extractFromWideTable(rows);
      if (wide && wide.parameters.length > 0) {
        parameters.push(...wide.parameters);
        continue;
      }
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

// Lines that are report/patient metadata, section chrome, or provider
// signatures rather than a test result - many real-world lab PDFs (see
// server/test/parameterExtractor.test.js for a real sample) print these
// interleaved with actual results, and each one contains a colon or number
// that would otherwise look enough like "name: value" to get misread as a
// bogus test result (e.g. "Page : 1 of 8", "SID No. : 17001214").
const NOISE_LINE_PATTERNS = [
  /^patient\s*:/i,
  /^name\s*:/i,
  /^age\s*\/\s*sex\s*:/i,
  /^sex\s*\/\s*age\s*:/i,
  /^referr(ed|er)\b/i,
  /^branch\s*:/i,
  /^bill\s*no\.?\s*:/i,
  /pid\b.*sid\s*no\.?\s*:/i,
  /^sid\s*no\.?\s*:/i,
  /^reg\.?\s*(date|no)\b/i,
  /^(coll(ection)?|report(ed)?)\s*date\s*(&|and)?\s*time\s*:/i,
  /^page\s*:?\s*\d+\s*(of|\/)\s*\d+/i,
  /^\(\s*method\s*:/i,
  /^\(\s*specimen\s*:/i,
  /^final\s+test\s+report$/i,
  /^investigation\s*\/\s*method/i,
  /^end\s+of\s+the\s+report$/i,
  /^dr\.[a-z.]/i,
  /^(microbiologist|biochemist|pathologist|consultant)$/i,
  /^\*/,
  /^note\s*:/i,
];

function isNoiseLine(line) {
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

// A long line ending in a lowercase-preceded period reads as prose (a
// disclaimer/explanatory paragraph), not a short test/parameter name -
// e.g. "The A1C test results reflects your average blood sugar level...".
// A short line starting with a lowercase letter is caught separately below
// (isWrappedContinuation) - a disclaimer paragraph that line-wraps mid
// sentence (e.g. "...fasting and illness cause\nfluctuations in TSH
// levels.") produces short fragments too, which this length check alone
// would miss.
function looksLikeSentence(line) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length > 6 && /[a-z]\.$/.test(line.trim());
}

// A real test/parameter name is reliably capitalized in every report seen
// so far; a line that starts with a lowercase letter is far more likely to
// be the tail end of a paragraph that line-wrapped (a disclaimer/footnote
// continuing from the line above) than an actual result's name.
function isWrappedContinuation(line) {
  return /^[a-z]/.test(line.trim());
}

// Parses a "Value [Unit] [Range] [Flag]" line that has no test name on it at
// all - common in reports that print the name several lines above the
// result (often separated by "(Method: ...)"/"(Specimen: ...)" lines), so
// the value line format itself starts directly with the value.
function parseValueOnlyLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const valueMatch = matchValueAt(tokens, 0);
  if (!valueMatch) return null;

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
    range = tokens.slice(cursor, cursor + 3).join(' ');
    cursor += 3;
  }
  if (cursor < tokens.length && FLAG_TOKEN.test(tokens[cursor])) {
    flag = tokens[cursor];
    cursor += 1;
  }

  return { value: valueMatch.value, unit, range, flag };
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
  // Require at least one more token after the value (a unit, range, or
  // flag) - a real "Name Value ..." line always has one of these in every
  // report seen so far. Without this, a name that itself ends in a bare
  // number (e.g. "VITAMIN B 12") gets misread as name="VITAMIN B",
  // value="12" whenever nothing else follows on the line.
  if (valueMatch.nextIndex >= tokens.length) return null;

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
  // A handful of real-world PDF exports (pdfjs text-run grouping) split a
  // single unit like "mg/dL" into two tokens, "mg/d" and "L" - normalize
  // that here rather than in the tokenizer, since otherwise the lone "L"
  // reads as a High/Low flag and the parse stops before the actual
  // reference range that follows it.
  const normalizedText = text.replace(/\bmg\/d\s+L\b/gi, 'mg/dL');
  const lines = normalizedText.split(/\r?\n/);

  // Many real-world lab reports print a result's name on its own line, then
  // one or more "(Method: ...)"/"(Specimen: ...)" lines, then the
  // value/unit/range several lines later on their own - not all on one
  // line the way a simple table row would be. pendingName carries the most
  // recent line that looked like a test name forward until a value-only
  // line consumes it (or a later name line replaces it, abandoning it - it
  // never got a value, so there's nothing to emit for it).
  let pendingName = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || isNoiseLine(trimmed)) continue;

    // A line that starts directly with the value (no name on it at all) -
    // pair it with whatever name most recently preceded it. Checked before
    // the same-line form below: when the very first token is already a
    // plausible value, that's an unambiguous signal this line has no name
    // on it, and looking further along the line for "a" value (the
    // same-line parser's approach) risks matching a stray comparator/range
    // token instead and mangling both the name and the value.
    const valueOnly = parseValueOnlyLine(trimmed);
    if (valueOnly) {
      if (pendingName) {
        parameters.push({
          test_name: pendingName,
          value: valueOnly.value,
          numeric_value: parseNumeric(valueOnly.value),
          unit: valueOnly.unit,
          reference_range: valueOnly.range,
          status_flag: valueOnly.flag,
          param_date: null,
          confidence: 0.6,
          needs_review: true,
          raw_source_text: `${pendingName} | ${trimmed}`,
        });
        pendingName = null;
      }
      continue;
    }

    // Self-contained "TestName Value Unit Range" form - also covers e.g. a
    // CSV/XLSX row that ended up here, or any report that does print both
    // on one line.
    const sameLine = parseTextLine(trimmed);
    if (sameLine && !looksLikeSentence(trimmed)) {
      parameters.push({
        test_name: sameLine.testName,
        value: sameLine.value,
        numeric_value: parseNumeric(sameLine.value),
        unit: sameLine.unit,
        reference_range: sameLine.range,
        status_flag: sameLine.flag,
        param_date: null,
        confidence: 0.6,
        needs_review: true,
        raw_source_text: trimmed,
      });
      continue;
    }

    // Neither a name+value line nor a bare value line - a candidate name
    // for whatever value line comes next, unless it reads as prose (or the
    // tail end of some).
    if (!looksLikeSentence(trimmed) && !isWrappedContinuation(trimmed)) {
      pendingName = trimmed;
    }
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
