const pool = require('../db/pool');
const audit = require('./auditLog');

// Separate, explicit consent dimensions (issue #104 §4) - never one bundled
// checkbox. Bumping POLICY_VERSION treats earlier grants as absent, so
// users are asked again after a material change to what's described.
const POLICY_VERSION = '2026-09-26';

const CONSENT_TYPES = {
  // Required to upload/store any medical file at all.
  medical_record_storage: { required: true },
  // Sending an uploaded report/scan (file, page images or extracted text)
  // to the external AI provider for extraction.
  ai_document_processing: { required: false },
  // AI summaries, insight wording, chat, diet and recipe suggestions that
  // use the person's health data.
  ai_health_insights: { required: false },
};

class ConsentRequiredError extends Error {
  constructor(consentType) {
    super(`Consent "${consentType}" is required for this action.`);
    this.code = 'consent_required';
    this.consentType = consentType;
  }
}

async function getConsents(userId) {
  const { rows } = await pool.query(
    `SELECT consent_type, policy_version, status, granted_at, revoked_at, granted_by_user_id
     FROM user_consents WHERE user_id = $1`,
    [userId]
  );
  const byType = new Map(rows.map((r) => [r.consent_type, r]));
  return Object.keys(CONSENT_TYPES).map((type) => {
    const row = byType.get(type);
    const granted = Boolean(row && row.status === 'granted' && row.policy_version === POLICY_VERSION);
    return {
      type,
      required: CONSENT_TYPES[type].required,
      granted,
      policyVersion: POLICY_VERSION,
      grantedAt: granted ? row.granted_at : null,
      revokedAt: row?.status === 'revoked' ? row.revoked_at : null,
      grantedByOther: Boolean(granted && row.granted_by_user_id && row.granted_by_user_id !== userId),
      needsReconsent: Boolean(row && row.status === 'granted' && row.policy_version !== POLICY_VERSION),
    };
  });
}

async function hasConsent(userId, consentType) {
  if (!CONSENT_TYPES[consentType]) throw new Error(`Unknown consent type ${consentType}`);
  const { rows } = await pool.query(
    `SELECT 1 FROM user_consents
     WHERE user_id = $1 AND consent_type = $2 AND status = 'granted' AND policy_version = $3`,
    [userId, consentType, POLICY_VERSION]
  );
  return rows.length > 0;
}

async function requireConsent(userId, consentType) {
  if (!(await hasConsent(userId, consentType))) throw new ConsentRequiredError(consentType);
}

// `grantedBy` is the signed-in account: the person themselves, or a
// caregiver acting for a managed family profile.
async function setConsent({ userId, consentType, granted, grantedBy, sourcePlatform }) {
  if (!CONSENT_TYPES[consentType]) throw new Error(`Unknown consent type ${consentType}`);
  await pool.query(
    `INSERT INTO user_consents (user_id, consent_type, policy_version, status, granted_at, revoked_at, granted_by_user_id, source_platform)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'granted' THEN now() END, CASE WHEN $4 = 'revoked' THEN now() END, $5, $6)
     ON CONFLICT (user_id, consent_type) DO UPDATE SET
       policy_version = EXCLUDED.policy_version,
       status = EXCLUDED.status,
       granted_at = CASE WHEN EXCLUDED.status = 'granted' THEN now() ELSE user_consents.granted_at END,
       revoked_at = CASE WHEN EXCLUDED.status = 'revoked' THEN now() ELSE user_consents.revoked_at END,
       granted_by_user_id = EXCLUDED.granted_by_user_id,
       source_platform = EXCLUDED.source_platform,
       updated_at = now()`,
    [userId, consentType, POLICY_VERSION, granted ? 'granted' : 'revoked', grantedBy || userId, sourcePlatform || null]
  );
  await audit.record({
    eventType: granted ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED',
    userId,
    purpose: consentType,
  });
  return getConsents(userId);
}

module.exports = {
  POLICY_VERSION,
  CONSENT_TYPES,
  ConsentRequiredError,
  getConsents,
  hasConsent,
  requireConsent,
  setConsent,
};
