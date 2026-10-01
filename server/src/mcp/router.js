const crypto = require('crypto');
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const config = require('../config');
const oauthService = require('../oauth/service');
const { runWithContext } = require('../lib/requestContext');
const { createMcpServer } = require('./server');
const { logError } = require('../lib/safeLog');

const router = express.Router();

function challenge(res, description) {
  res.set(
    'WWW-Authenticate',
    `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource"` +
      (description ? `, error="invalid_token", error_description="${description}"` : '')
  );
  return res.status(401).json({ error: 'unauthorized' });
}

router.use(async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const [scheme, token] = (req.header('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return challenge(res);
  try {
    const auth = await oauthService.verifyAccessToken(token);
    if (!auth) return challenge(res, 'Token expired, revoked or invalid');
    req.mcpAuth = auth;
    return runWithContext(
      { userId: auth.userId, sessionId: `mcp-${auth.grantId}`, requestId: crypto.randomUUID(), clientIp: req.ip, userAgent: req.get('user-agent') },
      () => next()
    );
  } catch (err) {
    return next(err);
  }
});

// Stateless Streamable HTTP: each POST is a self-contained JSON-RPC exchange.
router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
  const server = createMcpServer(req.mcpAuth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logError('mcp request', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

const notAllowed = (req, res) =>
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
router.get('/', notAllowed);
router.delete('/', notAllowed);

module.exports = router;
