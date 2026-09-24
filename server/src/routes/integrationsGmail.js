const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const authService = require('../services/authService');
const gmailConnectionService = require('../services/gmailConnectionService');
const gmailClient = require('../services/gmailClientService');
const gmailSearchService = require('../services/gmailSearchService');
const gmailImportService = require('../services/gmailImportService');
const { logGmailAction } = require('../services/integrationAuditService');

const router = express.Router();

// req.user is set by the requireAuth middleware applied per-route below
// (not globally on this router, unlike most others) - /callback is Google
// redirecting the user's own browser and carries no Authorization header,
// so it alone must stay outside requireAuth; every other route needs it.
function currentUserId(req) {
  return req.user.id;
}

function publicConnection(connection) {
  if (!connection) return { connected: false };
  return {
    connected: connection.status !== 'disconnected',
    status: connection.status,
    emailAddress: connection.email_address,
    scopes: connection.scopes ? connection.scopes.split(' ') : [],
    connectedAt: connection.connected_at,
    lastAuthorizedAt: connection.last_authorized_at,
    syncMode: connection.sync_mode,
    lastSyncStartedAt: connection.last_sync_started_at,
    lastSyncCompletedAt: connection.last_sync_completed_at,
    lastError: connection.status === 'reauth_required' ? connection.last_error : null,
  };
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days));
  return date;
}

// A tiny, dependency-free confirmation page - this response is rendered
// directly in the system browser Google redirected to, not inside the app,
// so there is no client-side router to hand it off to.
function resultPage(title, message) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F7F9FC; color: #101828; padding: 48px 24px; text-align: center; }
      h1 { font-size: 20px; margin-bottom: 8px; }
      p { color: #475467; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${message}</p>
    <p>You can close this window and return to EyeMyHealth.</p>
  </body>
</html>`;
}

// Looks up this user's connection and responds with the right error status
// if it can't be used for a Gmail API call right now - shared by every
// route below that needs one. Returns null (having already written the
// response) when there is nothing more the caller should do.
async function requireUsableConnection(req, res) {
  const connection = await gmailConnectionService.getConnectionByUserId(currentUserId(req));
  if (!connection || connection.status === 'disconnected') {
    res.status(404).json({ error: 'Gmail is not connected.' });
    return null;
  }
  if (connection.status === 'reauth_required') {
    res.status(409).json({ error: 'Gmail authorization has expired. Please reconnect Gmail.', reauthRequired: true });
    return null;
  }
  return connection;
}

async function accessTokenFor(connection) {
  const refreshToken = gmailConnectionService.decryptedRefreshToken(connection);
  try {
    return await gmailClient.getAccessToken(refreshToken);
  } catch (err) {
    if (err.code === 'GMAIL_REAUTH_REQUIRED') {
      await gmailConnectionService.markReauthRequired(connection.id, err.message);
    }
    throw err;
  }
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    if (!config.gmailClientId) return res.json({ configured: false, connected: false });
    const connection = await gmailConnectionService.getConnectionByUserId(currentUserId(req));
    res.json({ configured: true, ...publicConnection(connection) });
  } catch (err) {
    next(err);
  }
});

// Starts the OAuth authorization flow - returns a URL for the client to
// open in a browser (Linking.openURL on native, window.open on web) rather
// than redirecting itself, since this is called via fetch from the app, not
// navigated to directly.
router.get('/connect', requireAuth, (req, res) => {
  if (!config.gmailClientId) {
    return res.status(503).json({ error: 'Gmail integration is not configured on this server.' });
  }
  const state = authService.signGmailOAuthState(currentUserId(req));
  res.json({ authUrl: gmailClient.buildAuthUrl(state) });
});

// Public: Google redirects the user's own browser here after they approve
// or deny access. `state` is the only thing tying this request back to a
// EyeMyHealth user - see authService.signGmailOAuthState.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res
      .status(200)
      .send(resultPage('Gmail connection cancelled', 'You declined Gmail access, so nothing was connected.'));
  }

  let userId;
  try {
    userId = authService.verifyGmailOAuthState(state);
  } catch (err) {
    return res
      .status(400)
      .send(
        resultPage(
          'Gmail connection failed',
          'This connection link is invalid or has expired. Please try connecting again from the app.'
        )
      );
  }

  try {
    const { refreshToken, providerAccountId, emailAddress, scopes } = await gmailClient.exchangeCodeForTokens(code);
    const connection = await gmailConnectionService.upsertConnection({
      userId,
      providerAccountId,
      emailAddress,
      scopes,
      refreshToken,
    });
    await logGmailAction(userId, 'connect', { connectionId: connection.id, detail: { emailAddress } });
    res.status(200).send(resultPage('Gmail connected', `${emailAddress} is now connected to EyeMyHealth.`));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Gmail OAuth callback failed:', err.message);
    await logGmailAction(userId, 'error', { detail: { action: 'connect', message: err.message } });
    res.status(200).send(resultPage('Gmail connection failed', err.message || 'Something went wrong connecting Gmail.'));
  }
});

// User-initiated search (MVP "Mode A") - returns candidates for review,
// never imports anything itself.
router.post('/search', requireAuth, async (req, res, next) => {
  try {
    const connection = await requireUsableConnection(req, res);
    if (!connection) return;

    const accessToken = await accessTokenFor(connection);
    const sinceDate = req.body.sinceDays ? daysAgo(req.body.sinceDays) : connection.last_sync_checkpoint || undefined;
    const candidates = await gmailSearchService.findCandidates({ accessToken, sinceDate });

    await logGmailAction(currentUserId(req), 'search', {
      connectionId: connection.id,
      detail: { candidateCount: candidates.length },
    });
    res.json({ candidates });
  } catch (err) {
    if (err.code === 'GMAIL_REAUTH_REQUIRED') return res.status(409).json({ error: err.message, reauthRequired: true });
    next(err);
  }
});

// On-demand sync: same search as above, resumed from (and advancing) the
// stored checkpoint. Still returns candidates for the user to choose from
// rather than auto-importing - automatic background import is the
// follow-on "Mode B" the issue recommends only after this is proven out.
router.post('/sync', requireAuth, async (req, res, next) => {
  const connection = await requireUsableConnection(req, res);
  if (!connection) return;

  try {
    await gmailConnectionService.recordSyncStart(connection.id);
    const accessToken = await accessTokenFor(connection);
    const candidates = await gmailSearchService.findCandidates({
      accessToken,
      sinceDate: connection.last_sync_checkpoint || undefined,
    });
    const checkpoint = new Date();
    await gmailConnectionService.recordSyncCompletion(connection.id, { checkpoint });
    await logGmailAction(currentUserId(req), 'sync', {
      connectionId: connection.id,
      detail: { candidateCount: candidates.length },
    });
    res.json({ candidates, checkpoint });
  } catch (err) {
    await gmailConnectionService.recordSyncCompletion(connection.id, { error: err.message });
    if (err.code === 'GMAIL_REAUTH_REQUIRED') return res.status(409).json({ error: err.message, reauthRequired: true });
    next(err);
  }
});

router.post('/import', requireAuth, async (req, res, next) => {
  try {
    const connection = await requireUsableConnection(req, res);
    if (!connection) return;

    const selections = Array.isArray(req.body.selections) ? req.body.selections : [];
    if (selections.length === 0) {
      return res.status(400).json({ error: 'selections is required: an array of {messageId, attachmentId}.' });
    }
    for (const selection of selections) {
      if (!selection.messageId || !selection.attachmentId) {
        return res.status(400).json({ error: 'Each selection requires a messageId and attachmentId.' });
      }
    }

    const accessToken = await accessTokenFor(connection);
    const results = await gmailImportService.importSelections({
      userId: currentUserId(req),
      connection,
      accessToken,
      selections,
    });

    await logGmailAction(currentUserId(req), 'import', {
      connectionId: connection.id,
      detail: {
        imported: results.filter((r) => r.status === 'imported').length,
        duplicate: results.filter((r) => r.status === 'duplicate').length,
        errored: results.filter((r) => r.status === 'error').length,
      },
    });
    res.json({ results });
  } catch (err) {
    if (err.code === 'GMAIL_REAUTH_REQUIRED') return res.status(409).json({ error: err.message, reauthRequired: true });
    next(err);
  }
});

router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const connection = await requireUsableConnection(req, res);
    if (!connection) return;

    const { syncMode } = req.body;
    if (!['manual', 'auto'].includes(syncMode)) {
      return res.status(400).json({ error: 'syncMode must be "manual" or "auto".' });
    }
    const updated = await gmailConnectionService.setSyncMode(connection.id, syncMode);
    await logGmailAction(currentUserId(req), 'settings_updated', { connectionId: connection.id, detail: { syncMode } });
    res.json(publicConnection(updated));
  } catch (err) {
    next(err);
  }
});

// Revokes the stored authorization and stops future sync, but never
// touches reports/gmail_document_sources already imported - see
// gmailConnectionService.disconnect.
router.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    const connection = await gmailConnectionService.getConnectionByUserId(currentUserId(req));
    if (!connection || connection.status === 'disconnected') {
      return res.status(404).json({ error: 'Gmail is not connected.' });
    }

    if (connection.encrypted_refresh_token) {
      const refreshToken = gmailConnectionService.decryptedRefreshToken(connection);
      await gmailClient.revokeToken(refreshToken).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to revoke Gmail token with Google (disconnecting locally anyway):', err.message);
      });
    }
    await gmailConnectionService.disconnect(connection.id);
    await logGmailAction(currentUserId(req), 'disconnect', { connectionId: connection.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// "Link to imported Gmail documents" (Settings UI) - provenance list, never
// the email body/content, joined against the report it produced.
router.get('/documents', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT gds.id, gds.subject, gds.sender, gds.received_at, gds.original_filename, gds.created_at,
              r.id AS report_id, r.ingestion_status, r.effective_date
       FROM gmail_document_sources gds
       LEFT JOIN reports r ON r.id = gds.imported_report_id
       WHERE gds.user_id = $1
       ORDER BY gds.created_at DESC`,
      [currentUserId(req)]
    );
    res.json({ documents: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
