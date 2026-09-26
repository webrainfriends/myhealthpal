const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const { getContext } = require('../lib/requestContext');

// Append-only security audit trail (issue #104 §6). Records who/what/why
// for access to medical files and AI processing - never PHI, file
// contents, filenames, tokens or keys. The table itself refuses UPDATE and
// DELETE (migration 022), and user_id/report_id are not foreign keys so
// the trail survives the deletions it records.
const EVENT_TYPES = new Set([
  'REPORT_UPLOAD_STARTED',
  'REPORT_ENCRYPTED',
  'REPORT_DECRYPTED_FOR_PROCESSING',
  'REPORT_VIEWED',
  'REPORT_DOWNLOADED',
  'REPORT_DELETED',
  'AI_PROCESSING_STARTED',
  'AI_PROCESSING_COMPLETED',
  'AI_PROCESSING_FAILED',
  'AI_PROCESSING_BLOCKED',
  'CONSENT_GRANTED',
  'CONSENT_REVOKED',
  'KEY_REWRAPPED',
  'FILE_REENCRYPTED',
  'LEGACY_FILE_ENCRYPTED',
  'UPLOAD_REJECTED',
  'ACCESS_DENIED',
]);

function hashKey() {
  return config.security.auditHashKey || `audit:${config.jwtSecret}`;
}

// Keyed hash: lets repeated access from one address be correlated without
// storing the address itself.
function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', hashKey()).update(String(ip)).digest('hex').slice(0, 32);
}

function userAgentCategory(ua) {
  if (!ua) return null;
  if (/okhttp|Expo|ReactNative|CFNetwork|Dalvik/i.test(ua)) return 'mobile_app';
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'mobile_browser';
  if (/Mozilla|Chrome|Safari|Firefox/i.test(ua)) return 'desktop_browser';
  return 'other';
}

async function record(event) {
  if (!EVENT_TYPES.has(event.eventType)) throw new Error(`Unknown audit event type ${event.eventType}`);
  const ctx = getContext();
  try {
    await pool.query(
      `INSERT INTO security_audit_events
         (user_id, actor_user_id, report_id, resource_type, event_type, purpose, actor_type, request_id, ip_hash, user_agent_category, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.userId || null,
        event.actorUserId || ctx.userId || null,
        event.reportId || null,
        event.resourceType || (event.reportId ? 'report' : null),
        event.eventType,
        event.purpose || null,
        event.actorType || (ctx.userId ? 'user' : 'system'),
        ctx.requestId || null,
        hashIp(ctx.clientIp),
        userAgentCategory(ctx.userAgent),
        event.provider || null,
      ]
    );
  } catch (err) {
    // Auditing must never take the app down, but a failure is itself worth
    // knowing about - logged without the event's identifiers.
    // eslint-disable-next-line no-console
    console.error(`[audit] failed to record ${event.eventType}: ${err.message}`);
  }
}

module.exports = { record, hashIp, userAgentCategory, EVENT_TYPES };
