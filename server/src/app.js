const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requireAuth, requireAccountAuth, requireAdmin } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const reportsRouter = require('./routes/reports');
const healthParametersRouter = require('./routes/healthParameters');
const timelineRouter = require('./routes/timeline');
const dashboardRouter = require('./routes/dashboard');
const pinnedParametersRouter = require('./routes/pinnedParameters');
const insightsRouter = require('./routes/insights');
const chatRouter = require('./routes/chat');
const medicationsRouter = require('./routes/medications');
const activityRouter = require('./routes/activity');
const workoutsRouter = require('./routes/workouts');
const glucoseRouter = require('./routes/glucose');
const devicesRouter = require('./routes/devices');
const dietRouter = require('./routes/diet');
const dietSchedulesRouter = require('./routes/dietSchedules');
const kitchenRouter = require('./routes/kitchen');
const recipeReactionsRouter = require('./routes/recipeReactions');
const waterRouter = require('./routes/water');
const recipePreferencesRouter = require('./routes/recipePreferences');
const weightGoalRouter = require('./routes/weightGoal');
const healthProfileRouter = require('./routes/healthProfile');
const aiUsageRouter = require('./routes/aiUsage');
const filesRouter = require('./routes/files');
const integrationsGmailRouter = require('./routes/integrationsGmail');
const retestRouter = require('./routes/retest');
const insuranceRouter = require('./routes/insurance');
const smartUploadRouter = require('./routes/smartUpload');
const familyRouter = require('./routes/family');
const accountRouter = require('./routes/account');
const adminRouter = require('./routes/admin');
const consentsRouter = require('./routes/consents');
const connectedAppsRouter = require('./routes/connectedApps');
const { router: oauthRouter } = require('./oauth/router');
const mcpRouter = require('./mcp/router');
const mcpUploadRouter = require('./mcp/uploadRouter');
const { logError } = require('./lib/safeLog');
const { runWithContext } = require('./lib/requestContext');

const app = express();

// nginx on the same host is the only proxy; trusting just loopback makes
// req.ip the real client address (used, hashed, in security audit events).
app.set('trust proxy', 'loopback');

app.use(cors());
app.use(express.json());
// Every response here reflects a user's current data (reports still
// processing, freshly confirmed measurements, dashboard scores) - a cached
// copy served by a browser or intermediary would look like "my new report
// isn't showing up" even though the server has already moved on.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRouter);
// Everything below is a signed-in user's own data - requireAuth resolves
// req.user from a verified session token before any of these routes run,
// which is what actually keeps one user's data from ever being visible to
// another (a route trusting a client-supplied user id could not).
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/health-parameters', healthParametersRouter);
app.use('/api/timeline', requireAuth, timelineRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/pinned-parameters', requireAuth, pinnedParametersRouter);
app.use('/api/insights', requireAuth, insightsRouter);
app.use('/api/chat', requireAuth, chatRouter);
app.use('/api/medications', requireAuth, medicationsRouter);
app.use('/api/activity/workouts', requireAuth, workoutsRouter);
app.use('/api/activity', requireAuth, activityRouter);
app.use('/api/glucose', requireAuth, glucoseRouter);
app.use('/api/devices', requireAuth, devicesRouter);
app.use('/api/diet', requireAuth, dietRouter);
app.use('/api/diet-schedules', requireAuth, dietSchedulesRouter);
app.use('/api/kitchen', requireAuth, kitchenRouter);
app.use('/api/recipe-reactions', requireAuth, recipeReactionsRouter);
app.use('/api/water', requireAuth, waterRouter);
app.use('/api/recipe-preferences', requireAuth, recipePreferencesRouter);
app.use('/api/weight-goal', requireAuth, weightGoalRouter);
app.use('/api/health-profile', requireAuth, healthProfileRouter);
app.use('/api/ai-usage', requireAuth, aiUsageRouter);
app.use('/api/retest', requireAuth, retestRouter);
app.use('/api/insurance', requireAuth, insuranceRouter);
app.use('/api/uploads', requireAuth, smartUploadRouter);
app.use('/api/family', requireAccountAuth, familyRouter);
app.use('/api/account', requireAccountAuth, accountRouter);
app.use('/api/admin', requireAccountAuth, requireAdmin, adminRouter);
app.use('/api/consents', requireAuth, consentsRouter);
app.use('/api/connected-apps', requireAccountAuth, connectedAppsRouter);
// OAuth 2.1 authorization server for the MCP connector (/.well-known/*,
// /oauth/*). Public by nature: it is how a client obtains a token at all.
app.use(oauthRouter);
// Remote MCP endpoint (Streamable HTTP) for Claude / ChatGPT. Authenticated by
// its own OAuth access tokens (mcp/router.js), never the app's session JWT.
app.use('/mcp', mcpRouter);
// One-time upload pages the MCP create_upload_link tool hands out; the signed
// token in the URL is the credential (see mcp/uploadLinks.js).
app.use('/mcp-upload', mcpUploadRouter);
// Not wrapped in requireAuth - see routes/files.js for why (a plain link
// open can't carry an Authorization header, so a short-lived scoped token
// is the credential here instead).
app.use(
  '/api/files',
  // No session here (see routes/files.js), but file views are still
  // audited with request metadata.
  (req, res, next) => runWithContext({ requestId: crypto.randomUUID(), clientIp: req.ip, userAgent: req.get('user-agent') }, next),
  filesRouter
);
// Not wrapped in requireAuth either - its own /callback route is Google
// redirecting the user's browser and carries no Authorization header;
// every other route on this router applies requireAuth itself.
app.use('/api/integrations/gmail', integrationsGmailRouter);
app.get('/api/config/supported-formats', (req, res) => {
  res.json({
    extensions: Object.keys(config.uploadExtensions),
    maxUploadBytes: config.maxUploadBytes,
    maxHealthExportBytes: config.maxHealthExportBytes,
  });
});

// Typed security/privacy errors become clear client responses; everything
// else is a 500 whose log line is redacted (lib/safeLog.js) - never the raw
// error object, which can carry query parameters or request data.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'consent_required') {
    return res.status(409).json({ code: 'consent_required', consentType: err.consentType, error: 'Please review and accept the Privacy & AI terms before uploading.' });
  }
  if (err.code === 'ai_consent_required') {
    return res.status(409).json({ code: 'ai_consent_required', consentType: err.consentType, error: 'This AI feature is turned off for this profile. You can turn it on in Settings → Privacy & AI.' });
  }
  if (err.code === 'upload_rejected') {
    return res.status(400).json({ code: 'upload_rejected', error: err.message });
  }
  if (err.code === 'registration_closed') {
    return res.status(403).json({ code: 'registration_closed', error: err.message });
  }
  logError(`${req.method} ${req.baseUrl || ''}${req.route?.path || ''}`, err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
