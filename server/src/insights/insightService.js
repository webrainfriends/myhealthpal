const pool = require('../db/pool');
const { evaluateRules, isAbnormalFlag } = require('./insightRules');
const { generateExplanation } = require('./insightExplanationService');

const RULE_VERSION = 'v1';
const POINT_IN_TIME_TYPES = new Set(['new_result', 'change_from_previous', 'new_abnormal_flag']);

function buildDedupKey(candidate, healthParameterId) {
  if (POINT_IN_TIME_TYPES.has(candidate.type)) {
    const currentMeasurementId = candidate.evidenceMeasurementIds[candidate.evidenceMeasurementIds.length - 1];
    return `${candidate.type}:${currentMeasurementId}`;
  }
  return `${candidate.type}:${healthParameterId}`;
}

function sameEvidence(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  return setA.size === setB.size && [...setA].every((id) => setB.has(id));
}

async function fetchConfirmedSeries(userId, healthParameterId) {
  const { rows } = await pool.query(
    `SELECT hm.id AS measurement_id, hm.report_id, hp.display_name AS parameter_display_name,
            hm.numeric_value, hm.normalized_value, hm.normalized_unit, hm.raw_unit, hm.qualitative_value,
            hm.status_flag, COALESCE(r.effective_date, hm.sample_datetime::date, r.created_at::date) AS effective_date
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     JOIN health_parameters hp ON hp.id = hm.health_parameter_id
     WHERE r.user_id = $1 AND hm.health_parameter_id = $2 AND hm.is_confirmed = true
     ORDER BY effective_date ASC, hm.created_at ASC`,
    [userId, healthParameterId]
  );
  return rows.map((row) => ({
    measurementId: row.measurement_id,
    reportId: row.report_id,
    parameterDisplayName: row.parameter_display_name,
    numericValue: row.numeric_value,
    normalizedValue: row.normalized_value,
    normalizedUnit: row.normalized_unit,
    rawUnit: row.raw_unit,
    qualitativeValue: row.qualitative_value,
    statusFlag: row.status_flag,
    effectiveDate: row.effective_date,
    value: row.qualitative_value ?? row.normalized_value ?? row.numeric_value,
  }));
}

function buildEvidence(candidate) {
  const evidence = candidate.evidenceMeasurementIds.map((id) => ({ type: 'measurement', id }));
  for (const id of new Set(candidate.evidenceReportIds)) {
    evidence.push({ type: 'report', id });
  }
  return evidence;
}

async function persistInsight({ userId, healthParameterId, candidate, dedupKey, existingActive, language }) {
  const { title, explanation, provider, model } = await generateExplanation(candidate, language, userId);

  if (existingActive) {
    await pool.query(`UPDATE insights SET lifecycle_state = 'superseded', updated_at = now() WHERE id = $1`, [
      existingActive.id,
    ]);
  }

  const { rows } = await pool.query(
    `INSERT INTO insights (
       user_id, health_parameter_id, insight_type, title, explanation, severity, evidence,
       effective_start_date, effective_end_date, rule_version, provider, model, dedup_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      userId,
      healthParameterId,
      candidate.type,
      title,
      explanation,
      candidate.severity,
      JSON.stringify(buildEvidence(candidate)),
      candidate.effectiveStartDate,
      candidate.effectiveEndDate,
      RULE_VERSION,
      provider,
      model,
      dedupKey,
    ]
  );

  if (existingActive) {
    await pool.query('UPDATE insights SET superseded_by_insight_id = $2 WHERE id = $1', [existingActive.id, rows[0].id]);
  }

  return rows[0].id;
}

async function autoResolveIfNormal(userId, healthParameterId, current) {
  if (isAbnormalFlag(current.statusFlag)) return;
  await pool.query(
    `UPDATE insights
     SET lifecycle_state = 'resolved', updated_at = now()
     WHERE user_id = $1 AND health_parameter_id = $2 AND lifecycle_state = 'active'
       AND insight_type IN ('new_abnormal_flag', 'repeated_abnormal')`,
    [userId, healthParameterId]
  );
}

// Evaluates every rule for one newly-confirmed (or re-confirmed after
// correction) measurement and persists whatever fires, honoring dedup:
// point-in-time insight types are keyed to the measurement itself (so
// re-running is idempotent), window types (trend/repeated) are keyed to the
// parameter and only superseded when the evidence set actually changed.
async function runForMeasurement(measurementId) {
  const { rows } = await pool.query(
    `SELECT hm.*, r.user_id, u.preferred_language
     FROM health_measurements hm
     JOIN reports r ON r.id = hm.report_id
     JOIN users u ON u.id = r.user_id
     WHERE hm.id = $1`,
    [measurementId]
  );
  const measurement = rows[0];
  if (!measurement || !measurement.health_parameter_id || !measurement.is_confirmed) return [];

  const series = await fetchConfirmedSeries(measurement.user_id, measurement.health_parameter_id);
  const currentIndex = series.findIndex((m) => m.measurementId === measurementId);
  if (currentIndex === -1) return [];
  const current = series[currentIndex];
  const priorSeries = series.slice(0, currentIndex);

  const candidates = evaluateRules(current, priorSeries);
  const publishedIds = [];

  for (const candidate of candidates) {
    const dedupKey = buildDedupKey(candidate, measurement.health_parameter_id);
    const existing = await pool.query(
      `SELECT * FROM insights WHERE dedup_key = $1 AND lifecycle_state = 'active' ORDER BY created_at DESC LIMIT 1`,
      [dedupKey]
    );
    const existingActive = existing.rows[0] || null;

    if (existingActive) {
      const existingEvidenceIds = existingActive.evidence
        .filter((e) => e.type === 'measurement')
        .map((e) => e.id);
      if (sameEvidence(existingEvidenceIds, candidate.evidenceMeasurementIds)) {
        continue; // identical candidate already active — suppress duplicate
      }
    }

    const id = await persistInsight({
      userId: measurement.user_id,
      healthParameterId: measurement.health_parameter_id,
      candidate,
      dedupKey,
      existingActive,
      language: measurement.preferred_language,
    });
    publishedIds.push(id);
  }

  await autoResolveIfNormal(measurement.user_id, measurement.health_parameter_id, current);

  return publishedIds;
}

// Called before re-evaluating a measurement whose confirmed value changed:
// any insight that cited it is invalidated immediately, even if the
// re-evaluation below doesn't produce a fresh replacement.
async function supersedeInsightsForMeasurement(measurementId) {
  await pool.query(
    `UPDATE insights
     SET lifecycle_state = 'superseded', updated_at = now()
     WHERE lifecycle_state = 'active'
       AND evidence @> $1::jsonb`,
    [JSON.stringify([{ type: 'measurement', id: measurementId }])]
  );
}

module.exports = { runForMeasurement, supersedeInsightsForMeasurement };
