const pool = require('../db/pool');

const DUPLICATE_MAJORITY_THRESHOLD = 0.6;

// Measurement-level dedup (dedupService.js) flags individual suspected
// duplicate values. This looks at the *pattern* across a whole report: if
// most of its mapped measurements turn out to duplicate an earlier report,
// that's very likely the same document re-uploaded (or re-imported from
// another source) rather than a coincidence — worth surfacing on the
// timeline as a linked, non-independent event. Never deletes anything.
async function reconcileReportDuplicate(reportId) {
  const { rows } = await pool.query(
    `SELECT hm.duplicate_of_id, hs.report_id AS source_report_id
     FROM health_measurements hm
     JOIN health_measurements hs ON hs.id = hm.duplicate_of_id
     WHERE hm.report_id = $1 AND hm.health_parameter_id IS NOT NULL AND hm.duplicate_status = 'suspected'`,
    [reportId]
  );

  const mappedCountResult = await pool.query(
    `SELECT count(*) AS count FROM health_measurements WHERE report_id = $1 AND health_parameter_id IS NOT NULL`,
    [reportId]
  );
  const mappedCount = Number(mappedCountResult.rows[0].count);
  if (mappedCount === 0 || rows.length === 0) return null;

  const countsBySourceReport = new Map();
  for (const row of rows) {
    countsBySourceReport.set(row.source_report_id, (countsBySourceReport.get(row.source_report_id) || 0) + 1);
  }
  const [candidateReportId, candidateCount] = [...countsBySourceReport.entries()].sort((a, b) => b[1] - a[1])[0];

  if (candidateCount / mappedCount < DUPLICATE_MAJORITY_THRESHOLD) return null;

  await pool.query('UPDATE reports SET likely_duplicate_of_report_id = $2, updated_at = now() WHERE id = $1', [
    reportId,
    candidateReportId,
  ]);

  return candidateReportId;
}

module.exports = { reconcileReportDuplicate };
