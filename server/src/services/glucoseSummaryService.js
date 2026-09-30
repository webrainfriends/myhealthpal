// Turns individual glucometer readings into the diabetes card's daily view:
// one entry per day with that day's average/min/max and every reading behind
// it, each compared with the user's most recent lab report. A deterministic
// readout of the user's own data - never a diagnosis.

// General home-monitoring band (the widely used 70-180 mg/dL "time in
// range"), used only to describe a reading, not to judge the user.
const LOW_MG_DL = 70;
const HIGH_MG_DL = 180;
// Within this share of the lab figure counts as "about the same".
const SIMILAR_PERCENT = 10;

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function band(value) {
  if (value < LOW_MG_DL) return 'low';
  if (value > HIGH_MG_DL) return 'high';
  return 'in_range';
}

function isFasting(reading) {
  return /fasting/i.test(reading.mealContext || '');
}

// HbA1c (%) -> estimated average glucose (mg/dL), the ADA's eAG formula.
function estimatedAverageFromHba1c(hba1c) {
  return round(28.7 * hba1c - 46.7, 0);
}

function compare(measured, labValue) {
  if (measured === null || measured === undefined || !labValue) return null;
  const diff = round(measured - labValue, 0);
  const diffPercent = round(((measured - labValue) / labValue) * 100, 0);
  let direction = 'similar';
  if (Math.abs(diffPercent) > SIMILAR_PERCENT) direction = diff > 0 ? 'above' : 'below';
  return { labValue, diff, diffPercent, direction };
}

// Picks what each day's average is compared against, from the latest lab
// results (each { value, date, reportId } or null):
//  - average: the lab's own average-glucose figure - an "estimated average
//    glucose" if the report printed one, else derived from HbA1c - whichever
//    is more recent.
//  - fasting: the lab fasting glucose, compared with the day's fasting
//    readings only (a lab draw is fasting; a whole-day mean is not).
function buildLabBaselines(labs = {}) {
  const candidates = [];
  if (labs.glucose_mean) candidates.push({ ...labs.glucose_mean, basis: 'estimated_average', derived: false });
  if (labs.hba1c) {
    candidates.push({
      value: estimatedAverageFromHba1c(labs.hba1c.value),
      date: labs.hba1c.date,
      reportId: labs.hba1c.reportId,
      basis: 'hba1c',
      hba1c: labs.hba1c.value,
      derived: true,
    });
  }
  candidates.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  return {
    average: candidates[0] || null,
    fasting: labs.glucose_fasting ? { ...labs.glucose_fasting, basis: 'fasting' } : null,
    postPrandial: labs.glucose_post_prandial ? { ...labs.glucose_post_prandial, basis: 'post_prandial' } : null,
  };
}

// `readings`: [{ day: 'YYYY-MM-DD', time: 'HH:MM', value, mealContext }].
// `labs`: latest lab result per code - see buildLabBaselines.
function summarizeGlucose(readings, labs = {}) {
  const baselines = buildLabBaselines(labs);

  const byDay = new Map();
  for (const reading of readings) {
    if (!byDay.has(reading.day)) byDay.set(reading.day, []);
    byDay.get(reading.day).push(reading);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayReadings]) => {
      const sorted = [...dayReadings].sort((a, b) => a.time.localeCompare(b.time));
      const values = sorted.map((r) => r.value);
      const average = round(values.reduce((sum, v) => sum + v, 0) / values.length, 0);
      const fastingValues = sorted.filter(isFasting).map((r) => r.value);
      const fastingAverage = fastingValues.length
        ? round(fastingValues.reduce((sum, v) => sum + v, 0) / fastingValues.length, 0)
        : null;

      return {
        date: day,
        average,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
        band: band(average),
        fastingAverage,
        vsLabAverage: compare(average, baselines.average?.value),
        vsLabFasting: compare(fastingAverage, baselines.fasting?.value),
        readings: sorted.map((r) => ({
          time: r.time,
          value: r.value,
          mealContext: r.mealContext || null,
          feeling: r.feeling || null,
          hematocrit: r.hematocrit ?? null,
          note: r.note || null,
          band: band(r.value),
        })),
      };
    });

  const all = readings.map((r) => r.value);
  const overallAverage = all.length ? round(all.reduce((sum, v) => sum + v, 0) / all.length, 0) : null;

  return {
    readingCount: all.length,
    dayCount: days.length,
    overall: all.length
      ? {
          average: overallAverage,
          min: Math.min(...all),
          max: Math.max(...all),
          inRangePercent: round((all.filter((v) => band(v) === 'in_range').length / all.length) * 100, 0),
          vsLabAverage: compare(overallAverage, baselines.average?.value),
          from: days[days.length - 1].date,
          to: days[0].date,
        }
      : null,
    lab: baselines,
    thresholds: { low: LOW_MG_DL, high: HIGH_MG_DL },
    days,
  };
}

module.exports = { summarizeGlucose, buildLabBaselines, estimatedAverageFromHba1c, compare, band };
