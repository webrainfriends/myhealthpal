const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const consentService = require('../security/consentService');
const { verifyGoogleIdToken } = require('../services/googleAuthService');
const { verifyAppleIdentityToken } = require('../services/appleAuthService');
const service = require('./service');
const { SCOPES, ALL_SCOPES } = require('./scopes');
const { authorizePage, errorPage } = require('./authorizePage');
const { rateLimit } = require('./rateLimit');
const { logError } = require('../lib/safeLog');

const router = express.Router();
const base = () => config.publicBaseUrl;

// Verifiers are looked up per call so tests can substitute them.
const providers = {
  google: async (credential) => verifyGoogleIdToken(credential),
  apple: async (credential) => verifyAppleIdentityToken(credential),
};

const limiter = rateLimit({ limit: 60 });

function oauthJsonError(res, err) {
  if (err instanceof service.OAuthError || err.oauthError) {
    return res.status(err.status || 400).json({ error: err.oauthError, error_description: err.message });
  }
  logError('oauth', err);
  return res.status(500).json({ error: 'server_error' });
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

// ---------------------------------------------------------------- metadata

function protectedResourceMetadata(req, res) {
  res.json({
    resource: `${base()}/mcp`,
    authorization_servers: [base()],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'EyeMyHealth',
  });
}
router.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
router.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

function authorizationServerMetadata(req, res) {
  res.json({
    issuer: base(),
    authorization_endpoint: `${base()}/oauth/authorize`,
    token_endpoint: `${base()}/oauth/token`,
    registration_endpoint: `${base()}/oauth/register`,
    revocation_endpoint: `${base()}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ALL_SCOPES,
  });
}
router.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);
router.get('/.well-known/oauth-authorization-server/mcp', authorizationServerMetadata);

// ------------------------------------------------------------ registration

router.post('/oauth/register', limiter, express.json(), async (req, res) => {
  try {
    const client = await service.registerClient({
      clientName: req.body.client_name,
      redirectUris: req.body.redirect_uris,
    });
    res.status(201).json({
      ...client,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  } catch (err) {
    oauthJsonError(res, err);
  }
});

// --------------------------------------------------------------- authorize

router.get('/oauth/authorize', limiter, async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  const params = {
    client_id: req.query.client_id,
    redirect_uri: req.query.redirect_uri,
    response_type: req.query.response_type,
    code_challenge: req.query.code_challenge,
    code_challenge_method: req.query.code_challenge_method,
    scope: req.query.scope,
    state: typeof req.query.state === 'string' ? req.query.state : undefined,
  };
  try {
    const { client, scopes } = await service.validateAuthorizationRequest(params);
    res.type('html').send(authorizePage({ client, params, requestedScopes: scopes }));
  } catch (err) {
    // Never redirect on a bad client/redirect_uri - show the error here.
    res.status(400).type('html').send(errorPage(err.message));
  }
});

// Existing accounts only: connecting an AI app must not be a back door
// around the closed-beta registration cap.
async function findAccount(provider, providerUserId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE auth_provider = $1 AND provider_user_id = $2', [
    provider,
    providerUserId,
  ]);
  return rows[0] || null;
}

router.post('/oauth/authorize/login', limiter, express.json(), async (req, res) => {
  noStore(res);
  try {
    const { provider, credential, params } = req.body || {};
    if (!providers[provider] || typeof credential !== 'string' || !params) {
      throw new service.OAuthError('invalid_request', 'provider, credential and params are required.');
    }
    const { client } = await service.validateAuthorizationRequest(params);
    let identity;
    try {
      identity = await providers[provider](credential);
    } catch (err) {
      throw new service.OAuthError('access_denied', `Could not verify ${provider} sign-in.`, 401);
    }
    const user = await findAccount(provider, identity.providerUserId);
    if (!user) {
      throw new service.OAuthError('access_denied', 'No EyeMyHealth account found. Sign up in the EyeMyHealth app first, then connect again.', 403);
    }
    res.json({
      ticket: service.signTicket(user.id, params),
      displayName: user.display_name,
      email: user.email,
      clientName: client.client_name,
    });
  } catch (err) {
    oauthJsonError(res, err);
  }
});

router.post('/oauth/authorize/approve', limiter, express.json(), async (req, res) => {
  noStore(res);
  try {
    const { ticket, params, scopes, deny, consentExternalAi } = req.body || {};
    if (!params) throw new service.OAuthError('invalid_request', 'params are required.');
    await service.validateAuthorizationRequest(params);
    const userId = service.verifyTicket(ticket, params);
    const target = new URL(params.redirect_uri);
    if (params.state) target.searchParams.set('state', params.state);
    target.searchParams.set('iss', base());

    if (deny) {
      target.searchParams.set('error', 'access_denied');
      return res.json({ redirect: target.toString() });
    }
    const { code } = await service.approveAuthorization({ userId, params, approvedScopes: scopes });
    // The explicit "share my data with this AI app" choice, recorded for the
    // person's own profile (family profiles are decided in-app by whoever
    // looks after them).
    if (consentExternalAi === true) {
      await consentService.setConsent({
        userId,
        consentType: 'external_ai_connector',
        granted: true,
        grantedBy: userId,
        sourcePlatform: 'mcp_connector',
      });
    }
    target.searchParams.set('code', code);
    res.json({ redirect: target.toString() });
  } catch (err) {
    oauthJsonError(res, err);
  }
});

// ------------------------------------------------------------------- token

router.post('/oauth/token', limiter, express.urlencoded({ extended: false }), async (req, res) => {
  noStore(res);
  try {
    const b = req.body || {};
    if (b.grant_type === 'authorization_code') {
      return res.json(
        await service.exchangeCode({
          clientId: b.client_id,
          code: b.code,
          redirectUri: b.redirect_uri,
          codeVerifier: b.code_verifier,
        })
      );
    }
    if (b.grant_type === 'refresh_token') {
      return res.json(await service.refreshTokens({ clientId: b.client_id, refreshToken: b.refresh_token }));
    }
    throw new service.OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (err) {
    return oauthJsonError(res, err);
  }
});

router.post('/oauth/revoke', limiter, express.urlencoded({ extended: false }), async (req, res) => {
  noStore(res);
  try {
    await service.revokeToken({ clientId: req.body?.client_id, token: req.body?.token });
  } catch (err) {
    logError('oauth revoke', err);
  }
  res.status(200).json({});
});

module.exports = { router, providers, SCOPES };
