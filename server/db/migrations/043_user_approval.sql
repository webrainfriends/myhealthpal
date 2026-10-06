-- Admin approval for new sign-ins. Every existing account is grandfathered in
-- as 'approved' (the column default); authService creates new Google/Apple/
-- guest accounts as 'pending' until an admin approves or rejects them from
-- the admin screen (routes/admin.js). Pending accounts are read-only with no
-- AI features; rejected accounts can't use the app at all
-- (middleware/approval.js).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_decided_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_approval_status_idx ON users (approval_status) WHERE approval_status <> 'approved';
