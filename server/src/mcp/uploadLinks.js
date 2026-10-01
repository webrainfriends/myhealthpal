const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const pool = require('../db/pool');
const authService = require('../services/authService');
const familyService = require('../services/familyService');
const consentService = require('../security/consentService');

// A remote MCP tool cannot receive a file from the chat client, so the model
// hands the person a short-lived link instead. The link is a signed token
// bound to the connection (grant), the signed-in account and the profile the
// file is for. It opens a small upload page; the file then goes through the
// exact same pipeline as an upload in the app (type/virus checks, encrypted
// vault, classification). Single use: it stops working after one upload.
const TTL_SECONDS = 900;

function key() {
  return Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:mcp-upload:v1', 32));
}

function issue({ grantId, accountId, subjectId, category }) {
  return jwt.sign({ type: 'mcp_upload', g: grantId, a: accountId, s: subjectId, c: category || 'auto' }, key(), {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
    jwtid: crypto.randomUUID(),
  });
}

const used = new Map();
function markUsed(jti, expSeconds) {
  const now = Date.now();
  for (const [id, exp] of used) if (exp <= now) used.delete(id);
  used.set(jti, expSeconds * 1000);
}

class UploadLinkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Re-checks everything at the moment of use, not just when the link was made:
// disconnecting the app, removing a family link or withdrawing consent all
// kill outstanding links.
async function verify(token) {
  let p;
  try {
    p = jwt.verify(token, key(), { algorithms: ['HS256'] });
  } catch {
    throw new UploadLinkError(410, 'This upload link has expired. Ask your AI assistant for a new one.');
  }
  if (p.type !== 'mcp_upload') throw new UploadLinkError(410, 'This upload link is not valid.');
  if (used.has(p.jti)) throw new UploadLinkError(410, 'This upload link was already used. Ask your AI assistant for a new one.');

  const grant = (await pool.query('SELECT 1 FROM oauth_grants WHERE id = $1 AND revoked_at IS NULL', [p.g])).rows[0];
  if (!grant) throw new UploadLinkError(410, 'The AI app was disconnected, so this link no longer works.');

  const account = await authService.findUserById(p.a);
  const subject = await authService.findUserById(p.s);
  if (!account || !subject) throw new UploadLinkError(410, 'This upload link is not valid.');
  if (subject.id !== account.id) {
    const link = await familyService.findLink(account.id, subject.id);
    if (!link || link.role === 'sponsor' || link.access !== 'manage') {
      throw new UploadLinkError(403, 'You no longer have access to add files to this profile.');
    }
  }
  if (!(await consentService.hasConsent(subject.id, 'external_ai_connector'))) {
    throw new UploadLinkError(403, 'AI app access is turned off for this profile.');
  }
  return { account, subject, grantId: p.g, category: p.c, jti: p.jti, exp: p.exp };
}

module.exports = { issue, verify, markUsed, UploadLinkError, TTL_SECONDS };
