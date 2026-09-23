const express = require('express');
const cors = require('cors');
const config = require('./config');
const { requireAuth } = require('./middleware/auth');
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
const filesRouter = require('./routes/files');
const integrationsGmailRouter = require('./routes/integrationsGmail');

const app = express();

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
// Not wrapped in requireAuth - see routes/files.js for why (a plain link
// open can't carry an Authorization header, so a short-lived scoped token
// is the credential here instead).
app.use('/api/files', filesRouter);
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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
