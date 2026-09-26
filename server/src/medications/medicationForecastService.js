const pool = require('../db/pool');
const { getReferenceRange, scoreAgainstRange } = require('./referenceRangeService');
const { referenceSourceFor } = require('./citationSources');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateStr, today = new Date()) {
  if (!dateStr) return null;
  const start = new Date(dateStr);
  if (Number.isNaN(start.getTime())) return null;
  return Math.floor((today.getTime() - start.getTime()) / MS_PER_DAY);
}

// Classifies the medication's total daily dose (amount x frequency)
// against the knowledge base's typical daily-dose band. Returns null
// (never guessed) when either side is missing or the units don't match -
// dose adequacy is only ever compared like-for-like.
function classifyDose(medication, knowledgeEntry) {
  const typical = knowledgeEntry?.typicalDailyDose;
  if (!typical) return null;
  if (medication.dosage_amount == null || medication.frequency_per_day == null) return null;
  if (medication.dosage_unit !== typical.unit) return null;

  const dailyDose = Number(medication.dosage_amount) * Number(medication.frequency_per_day);
  let level = 'within_typical';
  if (dailyDose < typical.amountMin) level = 'below_typical';
  else if (dailyDose > typical.amountMax) level = 'above_typical';

  return { level, dailyDose, typicalMin: typical.amountMin, typicalMax: typical.amountMax, unit: typical.unit };
}

// Where elapsed treatment duration sits relative to a parameter link's
// typical onset window - computed purely from elapsed time and the
// knowledge base, never from an LLM guess.
function forecastStage(elapsedDays, onsetWeeksMin, onsetWeeksMax) {
  if (elapsedDays === null || onsetWeeksMin === null || onsetWeeksMin === undefined) return 'unknown';
  const elapsedWeeks = elapsedDays / 7;
  if (elapsedWeeks < onsetWeeksMin) return 'too_early';
  // No upper bound on file means there's nothing to "reassess by" - stay in
  // the expected-improvement stage indefinitely once the minimum is reached.
  if (onsetWeeksMax === null || onsetWeeksMax === undefined || elapsedWeeks <= onsetWeeksMax) {
    return 'improvement_expected_now';
  }
  return 'reassess_with_labs';
}

const STAGE_LABELS = {
  too_early: 'Too early to expect a change yet',
  improvement_expected_now: "In the expected improvement window - it's reasonable to see this start moving",
  reassess_with_labs: 'Past the expected window - worth rechecking with a lab test',
  unknown: 'Not enough information to forecast',
};

async function latestConfirmedMeasurement(userId, healthParameterId) {
  const { rows } = await pool.query(
    `SELECT hm.*, COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS effective_date
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     WHERE r.user_id = $1 AND hm.health_parameter_id = $2 AND hm.is_confirmed = true
     ORDER BY effective_date DESC NULLS LAST, hm.created_at DESC
     LIMIT 1`,
    [userId, healthParameterId]
  );
  return rows[0] || null;
}

// Builds the full forecast/scoring readout for one medication: dose
// adequacy, plus per-linked-parameter onset-window forecast and a
// standards-based (WHO/ICMR/FDA - never report-printed) score against the
// latest confirmed measurement.
async function buildMedicationForecast(medication, knowledgeEntry, today = new Date()) {
  const doseAssessment = classifyDose(medication, knowledgeEntry);
  const elapsedDays = daysSince(medication.start_date, today);

  const { rows: links } = await pool.query(
    `SELECT mpl.*, hp.code AS parameter_code, hp.display_name AS parameter_display_name
     FROM medication_parameter_links mpl
     JOIN health_parameters hp ON hp.id = mpl.health_parameter_id
     WHERE mpl.medication_id = $1
     ORDER BY hp.display_name ASC`,
    [medication.id]
  );

  const parameterForecasts = [];
  for (const link of links) {
    const stage = forecastStage(elapsedDays, link.typical_onset_weeks_min, link.typical_onset_weeks_max);
    const measurement = await latestConfirmedMeasurement(medication.user_id, link.health_parameter_id);
    const range = await getReferenceRange(link.health_parameter_id);
    const value = measurement ? measurement.normalized_value ?? measurement.numeric_value : null;
    const scoreResult = scoreAgainstRange(value, range);

    parameterForecasts.push({
      healthParameterId: link.health_parameter_id,
      parameterCode: link.parameter_code,
      parameterDisplayName: link.parameter_display_name,
      relationship: link.relationship,
      expectedDirection: link.expected_direction,
      rationale: link.rationale,
      onsetWeeksMin: link.typical_onset_weeks_min,
      onsetWeeksMax: link.typical_onset_weeks_max,
      forecastStage: stage,
      forecastLabel: STAGE_LABELS[stage],
      latestMeasurement: measurement
        ? { value, unit: measurement.normalized_unit || measurement.raw_unit, effectiveDate: measurement.effective_date }
        : null,
      standardRange: range
        ? {
            low: range.range_low,
            high: range.range_high,
            unit: range.unit,
            source: range.source,
            citation: range.citation,
            // An authentic, government/WHO-backed page a user can click
            // through to read more - never a guessed link (citationSources.js).
            citationSource: referenceSourceFor(range.source, range.source_url),
          }
        : null,
      standardStatus: scoreResult.status,
      inStandardRange: scoreResult.inRange,
    });
  }

  const scorable = parameterForecasts.filter((p) => p.inStandardRange !== null);
  const inRangeCount = scorable.filter((p) => p.inStandardRange).length;
  const standardsScorePercent = scorable.length > 0 ? Math.round((inRangeCount / scorable.length) * 100) : null;

  return { doseAssessment, elapsedDays, parameterForecasts, standardsScorePercent };
}

module.exports = { classifyDose, forecastStage, buildMedicationForecast, STAGE_LABELS };
