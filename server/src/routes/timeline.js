const express = require('express');
const pool = require('../db/pool');
const config = require('../config');

const router = express.Router();

function currentUserId(req) {
  return req.header('x-user-id') || config.demoUserId;
}

// Chronological view across reports, filterable by date range, report type,
// source, parameter category, and free-text search over the report's
// filename or its measurements' test names. Sorted by effective clinical
// date (falling back to upload date only for ordering when no effective
// date was ever confirmed/detected — the report itself still shows its
// `date_status` so that fallback is never presented as a real result date).
router.get('/', async (req, res, next) => {
  try {
    const { dateFrom = null, dateTo = null, reportType = null, source = null, category = null, search = null } = req.query;

    const { rows } = await pool.query(
      `SELECT r.id, r.original_filename, r.file_extension, r.effective_date, r.date_status, r.source_type,
              r.source_provider, r.report_type, r.ingestion_status, r.likely_duplicate_of_report_id,
              r.upload_timestamp, r.created_at,
              (SELECT count(*) FROM health_measurements hm WHERE hm.report_id = r.id) AS measurement_count,
              (SELECT count(*) FROM health_measurements hm
                 WHERE hm.report_id = r.id AND hm.status_flag IS NOT NULL AND lower(hm.status_flag) NOT IN ('normal', 'n'))
                AS abnormal_count,
              rsv.summary_text AS narrative_summary
       FROM reports r
       LEFT JOIN report_summaries rs ON rs.report_id = r.id
       LEFT JOIN report_summary_versions rsv ON rsv.id = rs.current_version_id
       WHERE r.user_id = $1
         AND ($2::date IS NULL OR COALESCE(r.effective_date, r.created_at::date) >= $2::date)
         AND ($3::date IS NULL OR COALESCE(r.effective_date, r.created_at::date) <= $3::date)
         AND ($4::text IS NULL OR r.report_type = $4)
         AND ($5::text IS NULL OR r.source_type = $5)
         AND (
           $6::text IS NULL OR $6 = '' OR
           r.original_filename ILIKE '%' || $6 || '%' OR
           EXISTS (SELECT 1 FROM health_measurements hm WHERE hm.report_id = r.id AND hm.raw_test_name ILIKE '%' || $6 || '%')
         )
         AND (
           $7::text IS NULL OR
           EXISTS (
             SELECT 1 FROM health_measurements hm
             LEFT JOIN health_parameters hp ON hp.id = hm.health_parameter_id
             WHERE hm.report_id = r.id AND hp.category = $7
           )
         )
       ORDER BY COALESCE(r.effective_date, r.created_at::date) DESC, r.created_at DESC`,
      [currentUserId(req), dateFrom, dateTo, reportType, source, search, category]
    );

    res.json({ timeline: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
