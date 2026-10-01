const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ToolError } = require('./toolError');

// Two-step protection for permanent actions. The first call returns a short
// summary of exactly what would be removed plus a confirmation token; only a
// second call carrying that token executes. The token is bound to the
// connection (grant), the person whose records they are (subject), the tool
// and the target id, expires in minutes, and works once - so a model cannot
// delete something the user never saw described, or replay an old approval.
const TTL_SECONDS = 300;

function key() {
  return Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, Buffer.alloc(0), 'myhealthpal:mcp-confirm:v1', 32));
}

const used = new Map(); // jti -> expiry ms
function sweep() {
  const now = Date.now();
  for (const [jti, exp] of used) if (exp <= now) used.delete(jti);
}

function issue({ grantId, subjectId, tool, targetId }) {
  return jwt.sign({ type: 'mcp_confirm', g: grantId, s: subjectId, t: tool, id: String(targetId) }, key(), {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
    jwtid: crypto.randomUUID(),
  });
}

function consume(token, { grantId, subjectId, tool, targetId }) {
  let p;
  try {
    p = jwt.verify(token, key(), { algorithms: ['HS256'] });
  } catch {
    throw new ToolError('confirmation_invalid', 'That confirmation has expired or is not valid. Ask for the deletion again to get a new one.');
  }
  if (p.type !== 'mcp_confirm' || p.g !== grantId || p.s !== subjectId || p.t !== tool || p.id !== String(targetId)) {
    throw new ToolError('confirmation_invalid', 'That confirmation was issued for a different action. Ask again.');
  }
  sweep();
  if (used.has(p.jti)) throw new ToolError('confirmation_invalid', 'That confirmation was already used.');
  used.set(p.jti, p.exp * 1000);
  return p;
}

module.exports = { issue, consume, TTL_SECONDS };
