const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const config = require('../config');
const { verifyReportDownloadToken } = require('../services/authService');
const { loadOwnedReport } = require('../security/reportAccess');
const { loadFileBuffer } = require('../security/secureUpload');
const audit = require('../security/auditLog');
const { logError } = require('../lib/safeLog');

const router = express.Router();

// A generic answer for every failure: a caller probing ids or tokens learns
// nothing about which check failed.
function linkInvalid(res) {
  return res.status(404).json({ error: 'This link has expired or is invalid. Go back and open the file again.' });
}

// Header-safe filename: no path, quotes, control or non-ASCII characters
// (the full name goes in the RFC 5987 filename* parameter).
function contentDisposition(originalFilename) {
  const base = path.basename(String(originalFilename || 'report'));
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').slice(0, 150) || 'report';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base.slice(0, 150))}`;
}

async function consumeSingleUseToken(jti) {
  await pool.query(`DELETE FROM download_token_uses WHERE used_at < now() - interval '1 day'`);
  const { rowCount } = await pool.query(
    'INSERT INTO download_token_uses (jti) VALUES ($1) ON CONFLICT DO NOTHING',
    [jti]
  );
  return rowCount === 1;
}

// Serves an original uploaded report file (PDF, DOCX, image, CSV, XLSX...)
// so it opens the way the browser/OS naturally handles that type.
// Deliberately NOT behind the Authorization-header requireAuth middleware:
// a plain link open can't attach a header, so the credential here is the
// short-lived, single-report token minted by GET /api/reports/:id/file-url.
//
// Order matters (issue #104 §3): token -> report id match -> ownership ->
// (single-use) -> only then is the file decrypted, in memory, and sent with
// no-store caching. Plaintext is never written anywhere.
router.get('/report/:id', async (req, res, next) => {
  try {
    let claims;
    try {
      claims = verifyReportDownloadToken(req.query.token);
    } catch (err) {
      return linkInvalid(res);
    }
    if (claims.reportId !== req.params.id) return linkInvalid(res);

    const report = await loadOwnedReport(claims.userId, req.params.id, { purpose: 'report_view' });
    if (!report) return linkInvalid(res);

    if (config.security.downloadTokenSingleUse && !(await consumeSingleUseToken(claims.jti))) {
      return res.status(410).json({ error: 'This link was already used. Go back and open the file again.' });
    }

    let buffer;
    try {
      buffer = await loadFileBuffer(report);
    } catch (err) {
      // Integrity/authentication failure, missing object, or key-service
      // error: fail closed, never serve anything partial.
      logError(`Could not decrypt report ${report.id} for viewing`, err);
      return res.status(404).json({ error: 'The original file is not available.' });
    }

    await audit.record({ eventType: 'REPORT_VIEWED', userId: report.user_id, reportId: report.id, purpose: 'report_view' });

    res.set('Content-Type', report.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', contentDisposition(report.original_filename));
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    // Rendered in a sandbox with no scripts, so a crafted file can't run
    // code on the app's origin.
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'");
    res.set('Referrer-Policy', 'no-referrer');
    res.end(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.contentDisposition = contentDisposition;
