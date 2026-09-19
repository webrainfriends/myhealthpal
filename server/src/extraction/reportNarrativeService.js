const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const config = require('../config');

const SAFETY_FOOTER =
  'This summary reflects only what is stated in the source document. It is not medical advice — please discuss any concerns with a qualified clinician.';

async function findPriorConfirmedMeasurement(userId, healthParameterId, excludeReportId) {
  const { rows } = await pool.query(
    `SELECT hm.*
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     WHERE r.user_id = $1
       AND hm.health_parameter_id = $2
       AND hm.report_id != $3
       AND hm.is_confirmed = true
     ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC
     LIMIT 1`,
    [userId, healthParameterId, excludeReportId]
  );
  return rows[0] || null;
}

function describeComparison(current, prior) {
  const value = current.normalized_value ?? current.numeric_value;
  const priorValue = prior.normalized_value ?? prior.numeric_value;
  const unit = current.normalized_unit || current.raw_unit || '';

  if (current.qualitative_value) {
    return current.qualitative_value.toLowerCase() === String(prior.qualitative_value || '').toLowerCase()
      ? 'unchanged'
      : `changed from "${prior.qualitative_value}" to "${current.qualitative_value}"`;
  }
  if (value === null || value === undefined || priorValue === null || priorValue === undefined) return null;
  if (Math.abs(value - priorValue) < 1e-9) return `unchanged at ${value} ${unit}`.trim();
  const direction = value > priorValue ? 'higher than' : 'lower than';
  return `${value} ${unit} (${direction} the previous ${priorValue} ${unit})`.trim();
}

async function buildComparisons(userId, reportId, measurements) {
  const comparisons = [];
  for (const m of measurements) {
    if (!m.health_parameter_id) continue;
    const prior = await findPriorConfirmedMeasurement(userId, m.health_parameter_id, reportId);
    if (!prior) continue;
    const description = describeComparison(m, prior);
    if (description) comparisons.push({ name: m.parameter_display_name || m.raw_test_name, description });
  }
  return comparisons;
}

function buildHeuristicNarrative(report, measurements, comparisons) {
  if (measurements.length === 0) {
    return `No health parameters could be confidently extracted from this ${report.file_extension.toUpperCase()} report. ${SAFETY_FOOTER}`;
  }

  const parts = [];
  parts.push(
    `This is a ${report.file_extension.toUpperCase()} health report with ${measurements.length} extracted parameter${
      measurements.length === 1 ? '' : 's'
    }.`
  );

  const flagged = measurements.filter((m) => m.status_flag && !/normal/i.test(m.status_flag));
  if (flagged.length > 0) {
    parts.push(
      `The source report flags ${flagged.length} value${flagged.length === 1 ? '' : 's'} as outside its reference range: ${flagged
        .slice(0, 5)
        .map((m) => `${m.parameter_display_name || m.raw_test_name} (${m.status_flag})`)
        .join(', ')}${flagged.length > 5 ? ', …' : ''}.`
    );
  }

  if (comparisons.length > 0) {
    parts.push(
      `Compared with your prior confirmed results: ${comparisons
        .slice(0, 5)
        .map((c) => `${c.name} is ${c.description}`)
        .join('; ')}.`
    );
  }

  const uncertain = measurements.filter((m) => m.needs_review);
  if (uncertain.length > 0) {
    parts.push(
      `${uncertain.length} value${uncertain.length === 1 ? '' : 's'} could not be interpreted with full confidence (unmapped, ambiguous, or low-confidence extraction) and should be reviewed.`
    );
  }

  parts.push(SAFETY_FOOTER);
  return parts.join(' ');
}

async function buildClaudeNarrative(report, measurements, comparisons) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const payload = {
    reportFormat: report.file_extension,
    measurements: measurements.map((m) => ({
      name: m.parameter_display_name || m.raw_test_name,
      value: m.raw_value,
      unit: m.raw_unit,
      referenceRange: m.reference_range_raw,
      flag: m.status_flag,
      confident: !m.needs_review,
    })),
    comparisonsToPriorConfirmedResults: comparisons,
  };

  const response = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system: [
      'You write short, plain-language summaries of a single health report for a non-clinical reader.',
      'State only what the data shows. Never invent a diagnosis, treatment recommendation, or clinical certainty not present in the input.',
      'Clearly distinguish the source report\'s own statements (e.g. its flags) from any comparison you make to prior results.',
      'If something could not be confidently read, say so plainly rather than guessing.',
      `Always end with exactly this sentence: "${SAFETY_FOOTER}"`,
    ].join(' '),
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : buildHeuristicNarrative(report, measurements, comparisons);
}

// Regenerates a report's narrative summary only if `sourceDataVersion` (bumped
// by the caller whenever measurements materially change) differs from the
// version the current summary was generated against — "don't regenerate
// unnecessarily if nothing changed".
async function generateReportSummary({ report, measurements, sourceDataVersion }) {
  const existing = await pool.query(
    `SELECT rs.id AS summary_id, rsv.source_data_version
     FROM report_summaries rs
     LEFT JOIN report_summary_versions rsv ON rsv.id = rs.current_version_id
     WHERE rs.report_id = $1`,
    [report.id]
  );

  if (existing.rows.length > 0 && existing.rows[0].source_data_version === sourceDataVersion) {
    return { regenerated: false };
  }

  const comparisons = await buildComparisons(report.user_id, report.id, measurements);
  const provider = config.summaryProvider === 'claude' && config.anthropicApiKey ? 'claude' : 'heuristic';
  const summaryText =
    provider === 'claude'
      ? await buildClaudeNarrative(report, measurements, comparisons)
      : buildHeuristicNarrative(report, measurements, comparisons);

  const summaryId =
    existing.rows[0]?.summary_id ||
    (await pool.query('INSERT INTO report_summaries (report_id) VALUES ($1) RETURNING id', [report.id])).rows[0].id;

  const versionResult = await pool.query(
    `INSERT INTO report_summary_versions (report_summary_id, summary_text, provider, model, source_data_version)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [summaryId, summaryText, provider, provider === 'claude' ? config.anthropicModel : null, sourceDataVersion]
  );

  await pool.query('UPDATE report_summaries SET current_version_id = $2 WHERE id = $1', [
    summaryId,
    versionResult.rows[0].id,
  ]);

  return { regenerated: true, summaryText };
}

// Call after anything that materially changes a report's measurements
// (initial processing, a confirmation, a correction): bumps the report's
// data_version and regenerates its narrative summary against the new
// version. generateReportSummary no-ops if the version didn't actually move.
async function refreshSummaryForReport(reportId) {
  const versionResult = await pool.query(
    'UPDATE reports SET data_version = data_version + 1, updated_at = now() WHERE id = $1 RETURNING *',
    [reportId]
  );
  const report = versionResult.rows[0];
  if (!report) return;

  const measurementsResult = await pool.query(
    `SELECT hm.*, hp.display_name AS parameter_display_name
     FROM health_measurements hm
     LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE hm.report_id = $1`,
    [reportId]
  );

  await generateReportSummary({
    report,
    measurements: measurementsResult.rows,
    sourceDataVersion: report.data_version,
  });
}

module.exports = { generateReportSummary, refreshSummaryForReport };
