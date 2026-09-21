const pool = require('../db/pool');

// Priority for choosing a single "effective date" for timeline ordering when
// more than one date type was found. Upload date is deliberately excluded —
// it is recorded (reports.upload_timestamp) but must never be silently used
// to represent when the report's results actually happened.
const EFFECTIVE_DATE_PRIORITY = ['sample_collection', 'test', 'result', 'report_publication', 'consultation'];

const LABELED_DATE_PATTERNS = [
  { dateType: 'sample_collection', pattern: /(?:sample|specimen|collection)\s*date\s*[:\-]?\s*([^\n,]+)/i },
  { dateType: 'test', pattern: /test\s*date\s*[:\-]?\s*([^\n,]+)/i },
  { dateType: 'result', pattern: /(?:result\s*date|reported\s*on)\s*[:\-]?\s*([^\n,]+)/i },
  { dateType: 'report_publication', pattern: /report\s*date\s*[:\-]?\s*([^\n,]+)/i },
  { dateType: 'consultation', pattern: /(?:consultation|visit)\s*date\s*[:\-]?\s*([^\n,]+)/i },
];

function parseDate(text) {
  const parsed = new Date(String(text).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Only tried when none of the more specific "X date:" labels matched — a
// bare "Date:" doesn't say which kind of date it is, so it's kept lower
// confidence and typed as 'test' (a neutral, non-upload bucket) rather than
// assumed to be any particular one.
const GENERIC_DATE_PATTERN = /(?:^|\s)date\s*[:\-]\s*([^\n,]+)/i;

function detectLabeledDatesFromText(text) {
  if (!text) return [];
  const found = [];
  for (const { dateType, pattern } of LABELED_DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const dateValue = parseDate(match[1]);
    if (dateValue) found.push({ dateType, dateValue, confidence: 0.85 });
  }

  if (found.length === 0) {
    const genericMatch = GENERIC_DATE_PATTERN.exec(text);
    const dateValue = genericMatch ? parseDate(genericMatch[1]) : null;
    if (dateValue) found.push({ dateType: 'test', dateValue, confidence: 0.5 });
  }

  return found;
}

// Falls back to whatever dates the measurements themselves carried (e.g. a
// CSV/XLSX "Date" column, or a date parsed off a PDF/DOCX text line) when no
// explicit "Report Date:"-style label was found. Agreement across multiple
// measurements is a much stronger signal than a single one.
function detectFromMeasurementDates(measurements) {
  const counts = new Map();
  for (const m of measurements) {
    if (!m.sample_datetime) continue;
    const day = new Date(m.sample_datetime).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  if (counts.size === 0) return [];

  const [mostCommonDate, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = count === measurements.length ? 0.9 : 0.6;
  return [{ dateType: 'test', dateValue: mostCommonDate, confidence }];
}

async function detectAndPersistReportDates({ reportId, document, measurements, uploadTimestamp, aiReportDate }) {
  const labeled = detectLabeledDatesFromText(document.text);
  let candidates = labeled.length > 0 ? labeled : detectFromMeasurementDates(measurements);

  // An AI extraction provider can read a date the label/regex patterns above
  // miss (odd phrasing, an unusual layout); only used when nothing more
  // reliable was already found, and never treated as more certain than an
  // explicitly labeled date.
  if (candidates.length === 0 && aiReportDate) {
    const dateValue = parseDate(aiReportDate);
    if (dateValue) candidates = [{ dateType: 'report_publication', dateValue, confidence: 0.7 }];
  }

  await pool.query('DELETE FROM report_dates WHERE report_id = $1 AND source = $2', [reportId, 'detected']);

  for (const candidate of candidates) {
    await pool.query(
      `INSERT INTO report_dates (report_id, date_type, date_value, confidence, source)
       VALUES ($1, $2, $3, $4, 'detected')`,
      [reportId, candidate.dateType, candidate.dateValue, candidate.confidence]
    );
  }
  await pool.query(
    `INSERT INTO report_dates (report_id, date_type, date_value, confidence, source)
     VALUES ($1, 'upload', $2, 1.0, 'detected')`,
    [reportId, new Date(uploadTimestamp).toISOString().slice(0, 10)]
  );

  let effectiveDate = null;
  for (const dateType of EFFECTIVE_DATE_PRIORITY) {
    const match = candidates.find((c) => c.dateType === dateType);
    if (match) {
      effectiveDate = match.dateValue;
      break;
    }
  }

  await pool.query(
    `UPDATE reports SET effective_date = $2, date_status = $3, updated_at = now() WHERE id = $1`,
    [reportId, effectiveDate, effectiveDate ? 'Detected' : 'Needs Review']
  );

  return { effectiveDate, dateStatus: effectiveDate ? 'Detected' : 'Needs Review' };
}

module.exports = { detectAndPersistReportDates };
