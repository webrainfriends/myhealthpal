const express = require('express');
const cors = require('cors');
const config = require('./config');
const reportsRouter = require('./routes/reports');
const healthParametersRouter = require('./routes/healthParameters');
const timelineRouter = require('./routes/timeline');
const dashboardRouter = require('./routes/dashboard');
const pinnedParametersRouter = require('./routes/pinnedParameters');
const insightsRouter = require('./routes/insights');
const chatRouter = require('./routes/chat');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/reports', reportsRouter);
app.use('/api/health-parameters', healthParametersRouter);
app.use('/api/timeline', timelineRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/pinned-parameters', pinnedParametersRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/chat', chatRouter);
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
