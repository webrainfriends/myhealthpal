const { getProviderClient, providerName } = require('./providerFactory');
const consentService = require('../security/consentService');
const audit = require('../security/auditLog');

// Central AI privacy gateway (issue #104 §5). Every call to an external AI
// provider goes through getAiClient(), which:
//  - maps the call's purpose to the consent it needs and checks the data
//    subject's *current* consent (fail closed: no subject, no call);
//  - records AI_PROCESSING_* audit events (purpose and provider only -
//    never prompts, responses or health data);
//  - returns a client exposing only messages.create / messages.stream.
// Prompts and responses are never logged here or by callers.

const PURPOSES = {
  report_extraction: 'ai_document_processing',
  medication_scan: 'ai_document_processing',
  diet_photo: 'ai_document_processing',
  diet_text_estimate: 'ai_health_insights',
  report_summary: 'ai_health_insights',
  insight_explanation: 'ai_health_insights',
  chat: 'ai_health_insights',
  diet_insight: 'ai_health_insights',
  recipe: 'ai_health_insights',
  custom_card_grouping: 'ai_health_insights',
  // A medicine's generic reference description - the request carries only
  // the medicine's name, no personal data, so no consent is needed.
  reference_lookup: null,
};

class AiConsentRequiredError extends Error {
  constructor(consentType, purpose) {
    super(`AI processing for "${purpose}" needs the "${consentType}" consent.`);
    this.code = 'ai_consent_required';
    this.consentType = consentType;
    this.purpose = purpose;
  }
}

function consentTypeFor(purpose) {
  if (!(purpose in PURPOSES)) throw new Error(`Unknown AI purpose "${purpose}"`);
  return PURPOSES[purpose];
}

// Whether a call for this purpose would be allowed - lets callers pick a
// local fallback up front instead of catching.
async function isAllowed({ subjectUserId, purpose }) {
  const consentType = consentTypeFor(purpose);
  if (!consentType) return true;
  if (!subjectUserId) return false;
  return consentService.hasConsent(subjectUserId, consentType);
}

function wrapCall(fn, { subjectUserId, purpose, reportId }) {
  return async (...args) => {
    await audit.record({ eventType: 'AI_PROCESSING_STARTED', userId: subjectUserId, reportId, purpose, provider: providerName });
    try {
      const result = await fn(...args);
      await audit.record({ eventType: 'AI_PROCESSING_COMPLETED', userId: subjectUserId, reportId, purpose, provider: providerName });
      return result;
    } catch (err) {
      await audit.record({ eventType: 'AI_PROCESSING_FAILED', userId: subjectUserId, reportId, purpose, provider: providerName });
      throw err;
    }
  };
}

async function getAiClient({ subjectUserId, purpose, reportId = null }) {
  const consentType = consentTypeFor(purpose);
  if (consentType) {
    const allowed = subjectUserId ? await consentService.hasConsent(subjectUserId, consentType) : false;
    if (!allowed) {
      await audit.record({ eventType: 'AI_PROCESSING_BLOCKED', userId: subjectUserId, reportId, purpose, provider: providerName });
      throw new AiConsentRequiredError(consentType, purpose);
    }
  }
  const client = getProviderClient();
  const meta = { subjectUserId, purpose, reportId };
  return {
    messages: {
      create: wrapCall((...args) => client.messages.create(...args), meta),
      // .stream(...).finalMessage() is the only streaming shape used here;
      // exposed as one awaited call so it's audited like create().
      streamFinal: wrapCall((params) => client.messages.stream(params).finalMessage(), meta),
    },
  };
}

// Data minimization: drops internal record identifiers (UUID-valued *id
// fields) from structured data before it's sent to the provider - the
// model never needs them, and the app keeps its own copy for evidence
// links.
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stripInternalIds(value) {
  if (Array.isArray(value)) return value.map(stripInternalIds);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/(^id$|_id$|Id$|Ids$|_ids$)/.test(k) && (typeof v === 'string' ? UUID_VALUE.test(v) : Array.isArray(v))) continue;
      out[k] = stripInternalIds(v);
    }
    return out;
  }
  return value;
}

module.exports = { getAiClient, isAllowed, AiConsentRequiredError, PURPOSES, stripInternalIds };
