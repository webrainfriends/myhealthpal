const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requireAuth, requireAccountAuth } = require('./middleware/auth');
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
const dietRouter = require('./routes/diet');
const recipePreferencesRouter = require('./routes/recipePreferences');
const weightGoalRouter = require('./routes/weightGoal');
const aiUsageRouter = require('./routes/aiUsage');
const filesRouter = require('./routes/files');
const integrationsGmailRouter = require('./routes/integrationsGmail');
const retestRouter = require('./routes/retest');
const familyRouter = require('./routes/family');
const accountRouter = require('./routes/account');
const consentsRouter = require('./routes/consents');
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
app.use('/api/activity', requireAuth, activityRouter);
app.use('/api/diet', requireAuth, dietRouter);
app.use('/api/recipe-preferences', requireAuth, recipePreferencesRouter);
app.use('/api/weight-goal', requireAuth, weightGoalRouter);
app.use('/api/ai-usage', requireAuth, aiUsageRouter);
app.use('/api/retest', requireAuth, retestRouter);
app.use('/api/family', requireAccountAuth, familyRouter);
app.use('/api/account', requireAccountAuth, accountRouter);
app.use('/api/consents', requireAuth, consentsRouter);
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
    extensions: Object.keys(config.supportedExtensions),
    maxUploadBytes: config.maxUploadBytes,
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
  logError(`${req.method} ${req.baseUrl || ''}${req.route?.path || ''}`, err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
