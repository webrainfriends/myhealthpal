const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const config = require('../config');
const { verifyReportDownloadToken, verifyMedicationPhotoDownloadToken, verifyWorkoutVideoToken } = require('../services/authService');
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

// Serves a medication photo the same way /report/:id serves a report's
// original file - a separately-scoped token (never the report one) minted
// by GET /api/medications/:id/photos/:photoId/file-url. A 'scan' photo (see
// migration 029) has no ciphertext of its own; it's served by decrypting
// the medication_scans row it points at instead.
router.get('/medication-photo/:id', async (req, res, next) => {
  try {
    let claims;
    try {
      claims = verifyMedicationPhotoDownloadToken(req.query.token);
    } catch (err) {
      return linkInvalid(res);
    }
    if (claims.photoId !== req.params.id) return linkInvalid(res);

    const { rows } = await pool.query('SELECT * FROM medication_photos WHERE id = $1 AND user_id = $2', [
      req.params.id,
      claims.userId,
    ]);
    const photo = rows[0];
    if (!photo) return linkInvalid(res);

    let buffer;
    try {
      if (photo.encryption_version == null && photo.scan_id) {
        const { rows: scanRows } = await pool.query('SELECT * FROM medication_scans WHERE id = $1 AND user_id = $2', [
          photo.scan_id,
          claims.userId,
        ]);
        if (!scanRows[0]) return linkInvalid(res);
        buffer = await loadFileBuffer(scanRows[0], { purpose: 'medication_photo_view', resourceType: 'medication_scan' });
      } else {
        buffer = await loadFileBuffer(photo, { purpose: 'medication_photo_view', resourceType: 'medication_photo' });
      }
    } catch (err) {
      logError(`Could not decrypt medication photo ${photo.id} for viewing`, err);
      return res.status(404).json({ error: 'The original file is not available.' });
    }

    await audit.record({
      eventType: 'MEDICATION_PHOTO_VIEWED',
      userId: photo.user_id,
      resourceType: 'medication_photo',
      purpose: 'medication_photo_view',
    });

    res.set('Content-Type', photo.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', contentDisposition(photo.original_filename));
    res.set('Content-Length', String(buffer.length));
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'");
    res.set('Referrer-Policy', 'no-referrer');
    res.end(buffer);
  } catch (err) {
    next(err);
  }
});

// Workout recording playback (issue #135 Phase 3). Same shape as the other
// file routes: a scoped short-lived token (no Authorization header on a media
// element), ownership re-checked in SQL, decrypt in memory, no-store caching.
// Video players need HTTP Range, so this answers byte ranges. The decrypted
// bytes are kept in memory for a couple of minutes (and zeroed on eviction)
// so the many range requests of one playback don't each decrypt the file.
const videoCache = new Map(); // assetId -> { buffer, timer }
function cacheVideo(id, buffer) {
  const existing = videoCache.get(id);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    const entry = videoCache.get(id);
    if (entry) entry.buffer.fill(0);
    videoCache.delete(id);
  }, 2 * 60 * 1000);
  timer.unref();
  videoCache.set(id, { buffer, timer });
  while (videoCache.size > 2) {
    const oldest = videoCache.keys().next().value;
    const entry = videoCache.get(oldest);
    clearTimeout(entry.timer);
    entry.buffer.fill(0);
    videoCache.delete(oldest);
  }
}

router.get('/workout-video/:id', async (req, res, next) => {
  try {
    let claims;
    try {
      claims = verifyWorkoutVideoToken(req.query.token);
    } catch (err) {
      return linkInvalid(res);
    }
    if (claims.assetId !== req.params.id) return linkInvalid(res);

    const { rows } = await pool.query(
      `SELECT * FROM workout_video_asset WHERE id = $1 AND user_id = $2 AND retention_status = 'retained'`,
      [req.params.id, claims.userId]
    );
    const asset = rows[0];
    if (!asset) return linkInvalid(res);

    let buffer = videoCache.get(asset.id)?.buffer;
    if (!buffer) {
      try {
        buffer = await loadFileBuffer(asset, { purpose: 'workout_video_view', resourceType: 'workout_video' });
      } catch (err) {
        logError(`Could not decrypt workout video ${asset.id} for playback`, err);
        return res.status(404).json({ error: 'The recording is not available.' });
      }
      cacheVideo(asset.id, buffer);
      await audit.record({ eventType: 'WORKOUT_VIDEO_VIEWED', userId: asset.user_id, resourceType: 'workout_video', purpose: 'workout_video_view' });
    }

    res.set('Content-Type', asset.mime_type || 'video/mp4');
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');

    const total = buffer.length;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!range) {
      res.set('Content-Length', String(total));
      return res.end(buffer);
    }
    let start = range[1] === '' ? total - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? total - 1 : Number(range[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || end < start) {
      res.set('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    end = Math.min(end, total - 1);
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${total}`);
    res.set('Content-Length', String(end - start + 1));
    return res.end(buffer.subarray(start, end + 1));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.contentDisposition = contentDisposition;
