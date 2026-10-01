const authService = require('../services/authService');
const familyService = require('../services/familyService');
const consentService = require('../security/consentService');
const audit = require('../security/auditLog');
const config = require('../config');
const { getTool } = require('./tools');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULT_BYTES = 200 * 1024;

// A tool failure the model/user should see and can act on. Anything else
// thrown inside a tool becomes a generic message (no internals leak).
class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const windows = new Map();
function checkRate(grantId) {
  const now = Date.now();
  let w = windows.get(grantId);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + 60000 };
    windows.set(grantId, w);
  }
  w.count += 1;
  if (w.count > config.mcp.rateLimitPerMinute) {
    throw new ToolError('rate_limited', 'Too many requests from this connection. Wait a minute and try again.');
  }
}

// Decides which person's records a call is about and whether this grant may
// touch them - the same rules as middleware/auth.js, applied to the model's
// optional `profileId` argument. The model never supplies a user id that is
// trusted directly: it must resolve through a family_links row.
async function resolveSubject(account, profileId, tool) {
  if (tool.accountLevel || !profileId || profileId === account.id) {
    return { subject: account, access: 'owner' };
  }
  const link = UUID_RE.test(profileId) ? await familyService.findLink(account.id, profileId) : null;
  if (!link) throw new ToolError('profile_forbidden', 'You do not have access to that profile. Use list_profiles to see available profiles.');
  if (link.role === 'sponsor') {
    throw new ToolError('profile_forbidden', 'Sponsors can only see the beneficiary summary, not the full profile.');
  }
  if (link.access === 'view' && isMutating(tool)) {
    throw new ToolError('view_only', 'You have view-only access to this profile.');
  }
  const subject = await authService.findUserById(profileId);
  if (!subject) throw new ToolError('profile_forbidden', 'You do not have access to that profile.');
  return { subject, access: link.access };
}

function isMutating(tool) {
  return tool.mutates === true || tool.annotations?.readOnlyHint === false;
}

function toolList(auth) {
  const { listTools } = require('./tools');
  // Only advertise what this grant may call; the check below is the real gate.
  return listTools()
    .filter((t) => auth.scopes.includes(t.scope))
    .map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema: withProfileId(inputSchema, name),
      annotations,
    }));
}

function withProfileId(schema, name) {
  const tool = getTool(name);
  if (tool.accountLevel) return schema;
  return {
    ...schema,
    properties: {
      ...(schema.properties || {}),
      profileId: {
        type: 'string',
        description: 'Optional. Act for this family profile (an id from list_profiles). Defaults to the signed-in user.',
      },
    },
  };
}

// The one choke point every MCP tool call passes through:
// scope -> rate limit -> profile -> consent -> audit -> run -> size cap.
async function callTool(auth, name, rawArgs) {
  const tool = getTool(name);
  if (!tool) throw new ToolError('unknown_tool', `Unknown tool "${name}".`);

  const deny = async (userId, reason, err) => {
    await audit.record({ eventType: 'MCP_TOOL_DENIED', userId, actorUserId: auth.userId, purpose: `${name}:${reason}` });
    throw err;
  };

  if (!auth.scopes.includes(tool.scope)) {
    return deny(auth.userId, 'scope', new ToolError('insufficient_scope', `This connection was not granted "${tool.scope}". Reconnect and allow it to use ${name}.`));
  }
  checkRate(auth.grantId);

  const account = await authService.findUserById(auth.userId);
  if (!account) throw new ToolError('unauthorized', 'Account no longer exists.');

  const { profileId, ...args } = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  let resolved;
  try {
    resolved = await resolveSubject(account, profileId, tool);
  } catch (err) {
    return deny(auth.userId, err.code || 'profile', err);
  }
  const { subject } = resolved;

  if (!(await consentService.hasConsent(subject.id, 'external_ai_connector'))) {
    const self = subject.id === account.id;
    return deny(
      subject.id,
      'consent',
      new ToolError(
        'consent_required',
        self
          ? 'AI app access is turned off for this profile. Turn on "AI apps" in EyeMyHealth > Settings > Privacy & AI, or reconnect and tick the sharing box.'
          : `AI app access is turned off for ${subject.display_name || 'this profile'}. Turn it on in EyeMyHealth > Settings > Privacy & AI for that profile.`
      )
    );
  }

  // No arguments or results are logged - only who, which tool, which grant.
  await audit.record({ eventType: 'MCP_TOOL_CALLED', userId: subject.id, actorUserId: account.id, purpose: name });

  const result = await tool.execute(args, {
    userId: subject.id,
    account,
    subject,
    language: subject.preferred_language || account.preferred_language || 'en',
    scopes: auth.scopes,
  });

  const text = JSON.stringify(result.data);
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
    throw new ToolError('result_too_large', 'That result is too large. Narrow the request (dates, parameter, or limit).');
  }
  return { data: result.data, evidence: result.evidence || [] };
}

module.exports = { callTool, toolList, ToolError };
