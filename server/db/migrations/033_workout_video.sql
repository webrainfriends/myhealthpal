-- AI Workout Coach Phase 3 (issue #135): privately retained workout video.
-- The video binary lives only in the encrypted vault (security/
-- encryptedFileStore.js: AES-256-GCM, KMS-wrapped per-file key, random
-- object key) - PostgreSQL holds the reference and metadata. Ownership is
-- always the internal user id from the verified session, never a
-- client-supplied Gmail address.

CREATE TABLE IF NOT EXISTS workout_video_asset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL UNIQUE REFERENCES workout_session(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_provider TEXT NOT NULL DEFAULT 'app_vault',
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  plaintext_sha256 TEXT,
  plaintext_md5 TEXT, -- integrity check only: the phone's file API can hash a file as MD5 natively
  client_sha256 TEXT,
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  upload_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (upload_status IN ('uploaded', 'verified', 'failed')),
  retention_status TEXT NOT NULL DEFAULT 'retained' CHECK (retention_status IN ('retained', 'deleted')),
  local_copy_deleted_at TIMESTAMPTZ,
  remote_deleted_at TIMESTAMPTZ,

  -- Encryption metadata (security/encryptedFileStore.js's COLUMNS). Cleared
  -- when the video is hard-deleted. storage_path stays NULL - it exists so
  -- accountDeletionService can treat this like the other file tables.
  encryption_version INTEGER,
  cipher_algorithm TEXT,
  storage_object_key TEXT,
  storage_path TEXT,
  encrypted_data_key BYTEA,
  key_provider TEXT,
  key_reference TEXT,
  key_version TEXT,
  cipher_iv BYTEA,
  cipher_auth_tag BYTEA,
  ciphertext_sha256 TEXT,
  encrypted_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workout_video_asset_user ON workout_video_asset(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_video_asset_storage_object_key
  ON workout_video_asset (storage_object_key) WHERE storage_object_key IS NOT NULL;

-- Sampled landmarks so the replay overlay (skeleton, joint angles, rep
-- markers) is drawn dynamically instead of storing a second rendered video.
-- Only written for sessions whose video is retained; removed with it.
CREATE TABLE IF NOT EXISTS workout_pose_segment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_fps NUMERIC(4,1) NOT NULL,
  frames_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workout_pose_segment_session ON workout_pose_segment(workout_session_id);
