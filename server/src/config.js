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
  // Apple's "Sign in with Apple" Services ID - acts as the OAuth client_id/
  // audience for the web flow. No Apple private key is needed here: only
  // verifying Apple-issued identity tokens against Apple's public JWKS,
  // never minting/refreshing Apple's own tokens server-side.
  appleClientId: process.env.APPLE_CLIENT_ID || null,
  extractionProvider: process.env.EXTRACTION_PROVIDER || 'heuristic',
  summaryProvider: process.env.SUMMARY_PROVIDER || 'heuristic',
  insightProvider: process.env.INSIGHT_PROVIDER || 'heuristic',
  // Diet photo identification always requires Claude (like medication scan
  // extraction, there is no heuristic vision substitute) - dietProvider
  // only controls whether the *tip phrasing* on top of the deterministic
  // pattern analysis is Claude-rephrased ('claude') or left as the
  // always-correct heuristic template (default).
  dietProvider: process.env.DIET_PROVIDER || 'heuristic',
  chatProvider: process.env.CHAT_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'unavailable'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
};
