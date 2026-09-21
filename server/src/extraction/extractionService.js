const pool = require('../db/pool');
const config = require('../config');
const { getProvider } = require('./providers');
const { normalizeCandidates } = require('./normalizationService');
const dedupService = require('./dedupService');

// Orchestrates one extraction attempt for a report: run the configured
// provider over the ingestion pipeline's normalized document, map every
// candidate onto the Health Parameter Registry, check for cross-report
// duplicates, and persist everything with full provenance. Returns the
// persisted measurements plus a few counts the caller uses for the report
// summary/status.
async function runExtraction({ reportId, userId, document, filePath, mimeType }) {
  const provider = getProvider();

  const runResult = await pool.query(
    `INSERT INTO extraction_runs (report_id, provider) VALUES ($1, $2) RETURNING id`,
    [reportId, provider.name]
  );
  const extractionRunId = runResult.rows[0].id;

  let candidates;
  let warnings;
  let rawModelOutput;
  let documentInfo;
  let ocrAttempted;
  try {
    ({ candidates, warnings, rawModelOutput, document: documentInfo, ocrAttempted } = await provider.extract(document, {
      filePath,
      mimeType,
    }));
  } catch (err) {
    await pool.query(
      `UPDATE extraction_runs SET status = 'Failed', error_message = $2, finished_at = now() WHERE id = $1`,
      [extractionRunId, err.message]
    );
    throw err;
  }

  const normalized = await normalizeCandidates(candidates);

  const measurements = [];
  for (const measurement of normalized) {
    const sourceResult = await pool.query(
      `INSERT INTO measurement_sources (report_id, raw_excerpt) VALUES ($1, $2) RETURNING id`,
      [reportId, measurement.raw_source_text]
    );
    const sourceId = sourceResult.rows[0].id;

    const duplicate = await dedupService.findDuplicate({
      userId,
      reportId,
      parameterId: measurement.health_parameter_id,
      sampleDatetime: measurement.sample_datetime,
      numericValue: measurement.numeric_value,
      normalizedValue: measurement.normalized_value,
      qualitativeValue: measurement.qualitative_value,
    });

    const { rows } = await pool.query(
      `INSERT INTO health_measurements (
         report_id, extraction_run_id, source_id, health_parameter_id,
         raw_test_name, raw_value, raw_unit,
         value_type, comparator, numeric_value, qualitative_value,
         normalized_unit, normalized_value,
         reference_range_raw, reference_range_context, status_flag, panel_category,
         sample_datetime, result_datetime,
         extraction_confidence, normalization_confidence, ambiguous_candidate_ids, needs_review,
         duplicate_status, duplicate_of_id
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10, $11,
         $12, $13,
         $14, $15, $16, $17,
         $18, $19,
         $20, $21, $22, $23,
         $24, $25
       ) RETURNING *`,
      [
        reportId,
        extractionRunId,
        sourceId,
        measurement.health_parameter_id,
        measurement.raw_test_name,
        measurement.raw_value,
        measurement.raw_unit,
        measurement.value_type,
        measurement.comparator,
        measurement.numeric_value,
        measurement.qualitative_value,
        measurement.normalized_unit,
        measurement.normalized_value,
        measurement.reference_range_raw,
        measurement.reference_range_context,
        measurement.status_flag,
        measurement.panel_category,
        measurement.sample_datetime,
        measurement.result_datetime,
        measurement.extraction_confidence,
        measurement.normalization_confidence,
        measurement.ambiguous_candidate_ids,
        measurement.needs_review,
        duplicate ? 'suspected' : 'none',
        duplicate ? duplicate.id : null,
      ]
    );
    measurements.push(rows[0]);
  }

  await pool.query(
    `UPDATE extraction_runs
     SET status = 'Succeeded', raw_model_output = $2, diagnostics = $3, finished_at = now()
     WHERE id = $1`,
    [
      extractionRunId,
      rawModelOutput ? JSON.stringify(rawModelOutput) : null,
      JSON.stringify({
        provider: provider.name,
        candidateCount: candidates.length,
        warnings,
        unmappedCount: measurements.filter((m) => !m.health_parameter_id && !m.ambiguous_candidate_ids).length,
        ambiguousCount: measurements.filter((m) => m.ambiguous_candidate_ids).length,
        duplicateCount: measurements.filter((m) => m.duplicate_status === 'suspected').length,
        document: documentInfo || null,
      }),
    ]
  );

  return { measurements, warnings, document: documentInfo || null, ocrAttempted: Boolean(ocrAttempted) };
}

module.exports = { runExtraction };
