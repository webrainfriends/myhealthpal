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

// Apple Health "Export All Health Data" and its parts. Kept apart from
// SUPPORTED_EXTENSIONS so Gmail attachment search (which keys off that list)
// doesn't start pulling in every .zip/.xml an inbox holds.
const HEALTH_EXPORT_EXTENSIONS = {
  zip: { mimeTypes: ['application/zip', 'application/x-zip-compressed'] },
  xml: { mimeTypes: ['text/xml', 'application/xml'] },
  gpx: { mimeTypes: ['application/gpx+xml', 'application/xml', 'text/xml'] },
};

module.exports = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024,
  // Retained workout recordings (issue #135 Phase 3). nginx must allow this
  // much on the upload route (deploy.yml).
  maxWorkoutVideoBytes: Number(process.env.MAX_WORKOUT_VIDEO_BYTES) || 100 * 1024 * 1024,
  // Days a retained recording is kept before scripts/purge-workout-videos.js
  // hard-deletes it. 0 = keep until the user deletes it.
  workoutVideoRetentionDays: Number(process.env.WORKOUT_VIDEO_RETENTION_DAYS) || 0,
  // Closed-beta ceiling on total `users` rows (guest, Google, Apple, and
  // managed family profiles all count) - see authService.withRegistrationCap.
  maxRegisteredUsers: Number(process.env.MAX_REGISTERED_USERS) || 20,
  // Email addresses (case-insensitive) allowed to use the admin session
  // cleanup screen (routes/admin.js) - lists every registered/guest login
  // and can delete one, or every guest login, on the spot. Comma-separated
  // for more than one; the app's own email/password is never involved,
  // this only ever gates against the signed-in account's verified
  // Google/Apple email.
  adminEmails: (process.env.ADMIN_EMAILS || 'rraja.edge@gmail.com')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  // Retest Radar's "Book test" link. {test} is replaced with the URL-encoded
  // test name and {panel} with the panel a lab lists it under (e.g. "lipid
  // profile") - point this at a lab partner's search/booking page when one
  // exists; the default is a nearby-labs map search.
  labBookingUrlTemplate:
    process.env.LAB_BOOKING_URL_TEMPLATE || 'https://www.google.com/maps/search/{panel}+test+lab+near+me',
  supportedExtensions: SUPPORTED_EXTENSIONS,
  healthExportExtensions: HEALTH_EXPORT_EXTENSIONS,
  uploadExtensions: { ...SUPPORTED_EXTENSIONS, ...HEALTH_EXPORT_EXTENSIONS },
  // A full Apple Health export.zip is routinely far larger than a lab PDF.
  maxHealthExportBytes: Number(process.env.MAX_HEALTH_EXPORT_BYTES) || 500 * 1024 * 1024,
  jwtSecret,
  // Public https origin of this API (no trailing slash). The MCP connector's
  // OAuth metadata, resource identifier and token audience are built from it.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/+$/, ''),
  mcp: {
    accessTokenTtlSeconds: Number(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS) || 3600,
    refreshTokenTtlDays: Number(process.env.MCP_REFRESH_TOKEN_TTL_DAYS) || 30,
    // Optional comma-separated allowlist of redirect hosts a dynamically
    // registered client may use (e.g. claude.ai,chatgpt.com). Empty = any
    // https host (plus loopback http for local clients).
    redirectHostAllowlist: (process.env.MCP_REDIRECT_HOST_ALLOWLIST || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    rateLimitPerMinute: Number(process.env.MCP_RATE_LIMIT_PER_MINUTE) || 120,
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  // Encrypted medical-file vault (issue #104, docs/security/). Every
  // uploaded report/scan is stored only as AES-256-GCM ciphertext under
  // encryptedStoreDir; its per-file key is wrapped by the key provider
  // (AWS KMS in production). See security/configValidation.js for what
  // production refuses to start without.
  security: {
    keyProvider: process.env.KEY_PROVIDER || null,
    kmsKeyId: process.env.KMS_KEY_ID || null,
    kmsRegion: process.env.KMS_REGION || process.env.AWS_REGION || 'ap-southeast-1',
    localDevMasterKey: process.env.LOCAL_DEV_MASTER_KEY || null,
    encryptedStoreDir: process.env.ENCRYPTED_STORE_DIR
      ? path.resolve(process.env.ENCRYPTED_STORE_DIR)
      : path.resolve(__dirname, '..', 'vault'),
    downloadTokenTtlSeconds: Number(process.env.DOWNLOAD_TOKEN_TTL_SECONDS) || 300,
    workoutVideoTokenTtlSeconds: Number(process.env.WORKOUT_VIDEO_TOKEN_TTL_SECONDS) || 900,
    downloadTokenSingleUse: process.env.DOWNLOAD_TOKEN_SINGLE_USE === 'true',
    // 'allow' only while legacy plaintext uploads still exist (before
    // scripts/encrypt-legacy-uploads.js has run); deploy.yml sets 'deny'.
    legacyPlaintextReads: process.env.LEGACY_PLAINTEXT_READS === 'allow' ? 'allow' : 'deny',
    malwareScanner: process.env.MALWARE_SCANNER || 'none',
    clamdHost: process.env.CLAMD_HOST || '127.0.0.1',
    clamdPort: Number(process.env.CLAMD_PORT) || 3310,
    parserTimeoutMs: Number(process.env.PARSER_TIMEOUT_MS) || 60000,
    retentionUnconfirmedScanDays: Number(process.env.RETENTION_UNCONFIRMED_SCAN_DAYS) || null,
    // Keys the privacy-safe IP hash in audit events; derived from
    // JWT_SECRET when unset so it's stable across restarts.
    auditHashKey: process.env.AUDIT_HASH_KEY || null,
  },
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
  // May list several comma-separated audiences: the web Services ID first
  // (what the web sign-in button is initialised with), then the iOS app's
  // bundle identifier (native Sign in with Apple tokens carry that as `aud`).
  appleClientIds: (process.env.APPLE_CLIENT_ID || '').split(',').map((v) => v.trim()).filter(Boolean),
  appleClientId: (process.env.APPLE_CLIENT_ID || '').split(',')[0].trim() || null,
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
