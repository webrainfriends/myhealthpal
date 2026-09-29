const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const { secureStore, encryptionInsertParts, deleteStoredFile } = require('../security/secureUpload');
const audit = require('../security/auditLog');
const { signWorkoutVideoToken } = require('./authService');
const { WorkoutError } = require('./workoutService');
const { extensionOf } = require('../middleware/upload');

// Retained workout recordings (issue #135 Phase 3). The binary goes into the
// same encrypted vault as medical files; this table only keeps references.
// Every function takes the internal user id from the verified session and
// scopes by it - a client can never name whose video it is.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime' };

async function ownedSession(userId, sessionId) {
  if (!UUID_RE.test(String(sessionId))) throw new WorkoutError(404, 'Workout not found.');
  const { rows } = await pool.query('SELECT id, status FROM workout_session WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  if (!rows[0]) throw new WorkoutError(404, 'Workout not found.');
  return rows[0];
}

async function findAsset(userId, sessionId) {
  const { rows } = await pool.query('SELECT * FROM workout_video_asset WHERE workout_session_id = $1 AND user_id = $2', [sessionId, userId]);
  return rows[0] || null;
}

function publicAsset(row) {
  if (!row) return { exists: false };
  return {
    exists: row.retention_status === 'retained',
    id: row.id,
    uploadStatus: row.upload_status,
    retentionStatus: row.retention_status,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    localCopyDeletedAt: row.local_copy_deleted_at,
    remoteDeletedAt: row.remote_deleted_at,
    createdAt: row.created_at,
  };
}

async function getStatus(userId, sessionId) {
  await ownedSession(userId, sessionId);
  return publicAsset(await findAsset(userId, sessionId));
}

async function upload(userId, sessionId, file) {
  const session = await ownedSession(userId, sessionId);
  if (session.status !== 'completed') throw new WorkoutError(409, 'Finish the workout before saving its recording.');
  if (!file) throw new WorkoutError(400, 'No video file was received.');
  const existing = await findAsset(userId, sessionId);
  if (existing && existing.retention_status === 'retained') throw new WorkoutError(409, 'This workout already has a saved recording. Delete it first to replace it.');

  const ext = extensionOf(file.originalname);
  const meta = await secureStore({ userId, buffer: file.buffer, extension: ext });
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const md5 = crypto.createHash('md5').update(file.buffer).digest('hex');
  if (existing) await pool.query('DELETE FROM workout_video_asset WHERE id = $1', [existing.id]);

  const enc = encryptionInsertParts(meta, 7);
  const { rows } = await pool.query(
    `INSERT INTO workout_video_asset (workout_session_id, user_id, mime_type, size_bytes, plaintext_sha256, plaintext_md5, upload_status, retention_status,
                                      ${enc.columns.join(', ')})
     VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', 'retained', ${enc.placeholders.join(', ')}) RETURNING *`,
    [sessionId, userId, MIME[ext] || 'video/mp4', file.buffer.length, sha, md5, ...enc.values]
  );
  await audit.record({ eventType: 'WORKOUT_VIDEO_UPLOADED', userId, resourceType: 'workout_video', purpose: 'workout_video_retain' });
  return publicAsset(rows[0]);
}

// The client sends the SHA-256 of the local file it uploaded; the local copy
// may only be deleted once the server confirms it stored the same bytes.
async function completeUpload(userId, sessionId, hashes = {}) {
  await ownedSession(userId, sessionId);
  const asset = await findAsset(userId, sessionId);
  if (!asset || asset.retention_status !== 'retained') throw new WorkoutError(404, 'No saved recording for this workout.');
  // Either hash is accepted (the phone can compute MD5 natively); a hash
  // that is present must match, and at least one must be present.
  const sha = typeof hashes.sha256 === 'string' ? hashes.sha256.toLowerCase() : null;
  const md5 = typeof hashes.md5 === 'string' ? hashes.md5.toLowerCase() : null;
  const ok = (sha || md5) && (!sha || sha === asset.plaintext_sha256) && (!md5 || md5 === asset.plaintext_md5);
  const { rows } = await pool.query(
    'UPDATE workout_video_asset SET client_sha256 = $2, upload_status = $3 WHERE id = $1 RETURNING *',
    [asset.id, (sha || md5 || '').slice(0, 64) || null, ok ? 'verified' : 'failed']
  );
  return { verified: !!ok, ...publicAsset(rows[0]) };
}

async function markLocalDeleted(userId, sessionId) {
  await ownedSession(userId, sessionId);
  const asset = await findAsset(userId, sessionId);
  if (!asset) throw new WorkoutError(404, 'No recording record for this workout.');
  const { rows } = await pool.query('UPDATE workout_video_asset SET local_copy_deleted_at = COALESCE(local_copy_deleted_at, now()) WHERE id = $1 RETURNING *', [asset.id]);
  return publicAsset(rows[0]);
}

// A short-lived, video-scoped URL path. No public object URL ever exists;
// the token is the only credential and expires in minutes.
async function mintPlaybackUrl(userId, sessionId) {
  await ownedSession(userId, sessionId);
  const asset = await findAsset(userId, sessionId);
  if (!asset || asset.retention_status !== 'retained' || asset.upload_status === 'failed') throw new WorkoutError(404, 'No saved recording for this workout.');
  const token = signWorkoutVideoToken({ userId, assetId: asset.id });
  return { url: `/api/files/workout-video/${asset.id}?token=${encodeURIComponent(token)}`, expiresInSeconds: config.security.workoutVideoTokenTtlSeconds };
}

// Hard delete: ciphertext removed from the vault, key material and object
// reference cleared, sampled landmarks dropped. The row remains as a
// tombstone (status + timestamps) for the user's own history and audit.
async function hardDelete(userId, sessionId, { reason = 'user_request' } = {}) {
  await ownedSession(userId, sessionId);
  const asset = await findAsset(userId, sessionId);
  if (!asset || asset.retention_status === 'deleted') return { exists: false };
  await deleteStoredFile(asset);
  await pool.query(
    `UPDATE workout_video_asset SET retention_status = 'deleted', remote_deleted_at = now(), storage_object_key = NULL,
       encrypted_data_key = NULL, cipher_iv = NULL, cipher_auth_tag = NULL, ciphertext_sha256 = NULL, encryption_version = NULL,
       key_reference = NULL, key_version = NULL WHERE id = $1`,
    [asset.id]
  );
  await pool.query('DELETE FROM workout_pose_segment WHERE workout_session_id = $1 AND user_id = $2', [sessionId, userId]);
  await audit.record({ eventType: 'WORKOUT_VIDEO_DELETED', userId, resourceType: 'workout_video', purpose: reason });
  return { exists: false };
}

const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;

async function savePoseSegment(userId, sessionId, body = {}) {
  await ownedSession(userId, sessionId);
  const asset = await findAsset(userId, sessionId);
  if (!asset || asset.retention_status !== 'retained') throw new WorkoutError(409, 'Landmarks are only stored for a retained recording.');
  const fps = Number(body.fps);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 30) throw new WorkoutError(400, 'fps must be between 0 and 30.');
  if (!Array.isArray(body.frames) || body.frames.length === 0) throw new WorkoutError(400, 'frames is required.');
  const json = JSON.stringify(body.frames);
  if (Buffer.byteLength(json) > MAX_SEGMENT_BYTES) throw new WorkoutError(413, 'Landmark data is too large.');
  await pool.query('DELETE FROM workout_pose_segment WHERE workout_session_id = $1 AND user_id = $2', [sessionId, userId]);
  await pool.query('INSERT INTO workout_pose_segment (workout_session_id, user_id, sample_fps, frames_json) VALUES ($1,$2,$3,$4)', [sessionId, userId, fps, json]);
  return { ok: true, frames: body.frames.length };
}

async function getPoseSegment(userId, sessionId) {
  await ownedSession(userId, sessionId);
  const { rows } = await pool.query(
    'SELECT sample_fps, frames_json FROM workout_pose_segment WHERE workout_session_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
    [sessionId, userId]
  );
  if (!rows[0]) return { fps: null, frames: [], events: [] };
  const { rows: events } = await pool.query(
    `SELECT f.event_timestamp_ms AS "timestampMs", f.rule_code AS "ruleCode", f.severity, f.coaching_message AS message
     FROM workout_form_event f WHERE f.workout_session_id = $1 ORDER BY f.event_timestamp_ms`, [sessionId]);
  return { fps: Number(rows[0].sample_fps), frames: rows[0].frames_json, events };
}

// Used by scripts/purge-workout-videos.js.
async function findExpired(days) {
  if (!days || days <= 0) return [];
  const { rows } = await pool.query(
    `SELECT workout_session_id, user_id FROM workout_video_asset
     WHERE retention_status = 'retained' AND created_at < now() - ($1 || ' days')::interval`, [String(days)]);
  return rows;
}

module.exports = { getStatus, upload, completeUpload, markLocalDeleted, mintPlaybackUrl, hardDelete, savePoseSegment, getPoseSegment, findExpired };
