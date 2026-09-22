// A DATE-only value from the API (report effective_date, medication start/
// end/expiry date, a dashboard trend point's day, ...) represents a
// specific calendar day with no attached time or timezone - never an
// instant to re-localize. `new Date('2026-09-01')` parses a bare
// 'YYYY-MM-DD' string as UTC midnight per the JS spec; formatting that with
// the device's local timezone then lands on the wrong day for anyone in a
// timezone behind UTC (all of the Americas) - e.g. it reads back as
// "Aug 31" in US Eastern. Building the Date from its Y/M/D components
// directly (local-time constructor, no timezone involved at all)
// sidesteps that: the calendar date shown always matches the calendar date
// stored, wherever the device is.
//
// A genuine timestamp (report.upload_timestamp, insight.generated_at,
// medication_scans' created_at, ...) is a real instant and should keep
// using `new Date(value).toLocaleString()`/`toLocaleDateString()` directly
// - those are correctly timezone-aware already via the device's own
// Intl/locale settings, which is exactly "time as per location" for a real
// point in time. Only calendar-date values need this helper.
export function parseCalendarDate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

const DEFAULT_OPTIONS = { year: 'numeric', month: 'short', day: 'numeric' };

export function formatCalendarDate(value, options = DEFAULT_OPTIONS) {
  const date = parseCalendarDate(value);
  return date ? date.toLocaleDateString(undefined, options) : null;
}
