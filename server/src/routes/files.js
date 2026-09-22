const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { verifyReportDownloadToken } = require('../services/authService');

const router = express.Router();

// Serves an original uploaded report file exactly as-is (PDF, DOCX, image,
// CSV, XLSX, ...) so it opens the way the browser/OS naturally handles that
// type - a PDF or image previews inline, a DOCX/XLSX/CSV hands off to
// whatever app the device has for it. Deliberately NOT behind the
// Authorization-header requireAuth middleware every other /api/reports
// route uses: a plain link open (window.open, Linking.openURL, an <a
// href>) can't attach a header, so auth here is the short-lived,
// single-report-scoped token minted by GET /api/reports/:id/file-url
// instead. The token is the only credential checked - there is no
// fallback to any other identity source.
router.get('/report/:id', async (req, res, next) => {
  try {
    let claims;
    try {
      claims = verifyReportDownloadToken(req.query.token);
    } catch (err) {
      return res.status(401).json({ error: 'This link has expired or is invalid. Go back and open the file again.' });
    }
    if (claims.reportId !== req.params.id) {
      return res.status(401).json({ error: 'This link is not valid for this file.' });
    }

    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [
      req.params.id,
      claims.userId,
    ]);
    const report = rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (!fs.existsSync(report.storage_path)) {
      return res.status(404).json({ error: 'The original file is no longer available on the server.' });
    }

    res.set('Content-Type', report.mime_type || 'application/octet-stream');
    // 'inline' (not 'attachment') so a PDF/image opens in the browser tab
    // instead of forcing a download - filename still guides what a
    // DOCX/XLSX/CSV the browser can't render inline gets saved as.
    const safeFilename = path.basename(report.original_filename).replace(/"/g, '');
    res.set('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.set('Cache-Control', 'private, max-age=60');

    fs.createReadStream(report.storage_path).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
