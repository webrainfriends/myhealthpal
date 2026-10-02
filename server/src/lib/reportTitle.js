// A human-readable title for a report, built from what the report *is* (its
// type or imaging modality, the lab that issued it, its date) rather than
// its filename - uploads are routinely named with random codes
// ("a3f9c2e1.pdf"), which tells a person (or an assistant reading the data)
// nothing about which report is which. The filename stays available as a
// separate field.

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function titleCase(text) {
  return String(text)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// `row` is a reports row (or a subset of it). `hasMeasurements` is optional;
// when it is explicitly 0/false and nothing else describes the report, the
// title says so instead of calling an empty import a "Health report".
function reportDisplayTitle(row) {
  if (!row) return 'Health report';

  let kind = row.report_type ? titleCase(row.report_type) : null;
  if (!kind && row.modality) {
    kind = [titleCase(row.modality), row.body_region ? titleCase(row.body_region) : null].filter(Boolean).join(' - ');
  }
  if (!kind && row.source_type === 'glucose_export') kind = 'Glucose meter readings';
  if (!kind) kind = 'Health report';

  const parts = [kind];
  if (row.source_provider) parts.push(String(row.source_provider).trim());
  const date = isoDate(row.effective_date);
  if (date) parts.push(date);
  return parts.join(' · ');
}

module.exports = { reportDisplayTitle };
