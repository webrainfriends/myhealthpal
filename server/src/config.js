require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

// A stable secret is required to keep issued session tokens valid across
// restarts/deploys - deploy.yml generates one once and persists it in
// server/.env (like the DB password) rather than regenerating it every
// deploy. Only auto-generate an ephemeral one here as a local-dev
// convenience so `npm start` works out of the box; every restart then
// invalidates existing sessions, which is fine for local development.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    'JWT_SECRET not set - generated an ephemeral one for this process only. ' +
      'Every restart will invalidate existing sessions; set JWT_SECRET in .env for a stable one.'
  );
}

// Encrypts Gmail OAuth refresh tokens at rest (see lib/tokenCipher.js) - must
// be a stable 32-byte key (64 hex chars) across restarts, same reasoning as
// JWT_SECRET above. Generate with `openssl rand -hex 32`. Falling back to an
// ephemeral key is safe for local dev (a restart just forces reconnecting
// Gmail, the same way it forces re-signing-in) but must never happen in a
// real deployment, where it would silently make every stored refresh token
// undecryptable on the next restart.
let gmailTokenEncryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
if (gmailTokenEncryptionKey && !/^[0-9a-f]{64}$/i.test(gmailTokenEncryptionKey)) {
  throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with `openssl rand -hex 32`.');
}
if (!gmailTokenEncryptionKey) {
  gmailTokenEncryptionKey = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    'GMAIL_TOKEN_ENCRYPTION_KEY not set - generated an ephemeral one for this process only. ' +
      'Every restart will require reconnecting Gmail; set GMAIL_TOKEN_ENCRYPTION_KEY in .env for a stable one.'
  );
}

// Optional per-model price overrides for AI usage cost estimates (see
// services/aiUsageService.js), USD per 1M tokens, e.g.
// AI_PRICING_JSON='{"claude-sonnet-5":{"input":2,"output":10}}'. Also takes
// optional cacheWrite/cacheRead rates. Merged over the built-in table.
let aiPricingOverrides = {};
if (process.env.AI_PRICING_JSON) {
  try {
    aiPricingOverrides = JSON.parse(process.env.AI_PRICING_JSON);
  } catch (err) {
    throw new Error(`AI_PRICING_JSON is not valid JSON: ${err.message}`);
  }
}

const SUPPORTED_EXTENSIONS = {
  pdf: { mimeTypes: ['application/pdf'] },
  jpg: { mimeTypes: ['image/jpeg'] },
  jpeg: { mimeTypes: ['image/jpeg'] },
  png: { mimeTypes: ['image/png'] },
  doc: { mimeTypes: ['application/msword'] },
  docx: { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  csv: { mimeTypes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'] },
  xls: { mimeTypes: ['application/vnd.ms-excel'] },
  xlsx: { mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
};

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024,
  supportedExtensions: SUPPORTED_EXTENSIONS,
  jwtSecret,
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  // Gmail integration (issue #54) - a *separate* OAuth client from
  // GOOGLE_CLIENT_ID above: that one only verifies a client-issued identity
  // token for sign-in, while this one needs client secret + redirect URI to
  // run the server-side Authorization Code flow required to obtain and
  // refresh a Gmail-scoped offline refresh token. Leave unset to hide the
  // Gmail connection feature entirely.
  gmailClientId: process.env.GMAIL_CLIENT_ID || null,
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || null,
  gmailRedirectUri: process.env.GMAIL_REDIRECT_URI || null,
  gmailTokenEncryptionKey: Buffer.from(gmailTokenEncryptionKey, 'hex'),
  // Least-privilege scopes only: gmail.readonly to search/read messages and
  // attachments (never send/modify/delete/trash), plus openid+email solely
  // to know which Gmail address is connected for display in Settings - no
  // separate Google profile scope is requested.
  gmailScopes: ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email'],
  // How far back an initial (no-checkpoint) search/sync looks.
  gmailInitialSearchWindowDays: Number(process.env.GMAIL_INITIAL_SEARCH_WINDOW_DAYS) || 180,
  // Apple's "Sign in with Apple" Services ID - acts as the OAuth client_id/
  // audience for the web flow. No Apple private key is needed here: only
  // verifying Apple-issued identity tokens against Apple's public JWKS,
  // never minting/refreshing Apple's own tokens server-side.
  appleClientId: process.env.APPLE_CLIENT_ID || null,
  extractionProvider: process.env.EXTRACTION_PROVIDER || 'heuristic',
  summaryProvider: process.env.SUMMARY_PROVIDER || 'heuristic',
  insightProvider: process.env.INSIGHT_PROVIDER || 'heuristic',
  // Grouping an unmapped lab result (no Health Parameter Registry match) into
  // a dashboard card label ("AI brain" grouping - see customCardService.js).
  // 'claude' asks the model for a short, sensible group name/icon per unseen
  // test name (cached in custom_parameter_groups so it's asked once, ever);
  // the default keyword heuristic always succeeds with no API call.
  customCardProvider: process.env.CUSTOM_CARD_PROVIDER || 'heuristic',
  // Medication details for a name outside medicationKnowledgeBase.js's
  // curated list (see medicationKnowledgeService.js). Unlike the other
  // *_PROVIDER flags there is no safe non-AI fallback here (getting a
  // medical fact wrong is a real risk) - 'unavailable' (the default)
  // means an uncurated medication simply shows nothing, same as before
  // this service existed, rather than a guess.
  medicationKnowledgeProvider:
    process.env.MEDICATION_KNOWLEDGE_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'unavailable'),
  // Diet photo identification always requires Claude (like medication scan
  // extraction, there is no heuristic vision substitute) - dietProvider
  // only controls whether the *tip phrasing* on top of the deterministic
  // pattern analysis is Claude-rephrased ('claude') or left as the
  // always-correct heuristic template (default).
  dietProvider: process.env.DIET_PROVIDER || 'heuristic',
  chatProvider: process.env.CHAT_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'unavailable'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  aiPricingOverrides,
};
