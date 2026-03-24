'use strict';

const path    = require('path');
const express = require('express');
const { initDb }   = require('./db/init');
const { createLogger } = require('./lib/logger');

// Route modules
const oauthRoutes     = require('./routes/oauth');
const webhookRoutes   = require('./routes/webhooks');
const locationRoutes  = require('./routes/locations');
const agentRoutes     = require('./routes/agents');
const callRoutes      = require('./routes/calls');
const analyzeRoutes   = require('./routes/analyze');
const dashboardRoutes = require('./routes/dashboard');

const log = createLogger('app');

async function createApp() {
  // ─── DB initialisation (idempotent table creation) ─────────────────────
  await initDb();

  const app = express();

  // ─── Body parsing ───────────────────────────────────────────────────────
  // Webhooks route needs raw body for HMAC verification — mounted BEFORE json()
  app.use('/webhooks/ghl', webhookRoutes);

  // All other routes get JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // ─── Serve Vue dashboard from public/ ──────────────────────────────────
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ─── Health & info ──────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      ok:      true,
      service: 'ghl-voice-ai-copilot',
      time:    new Date().toISOString(),
    });
  });

  // ─── OAuth ─────────────────────────────────────────────────────────────
  app.use('/', oauthRoutes);                          // /install-url, /oauth/callback

  // ─── API — all location-scoped routes ──────────────────────────────────
  app.use('/api/locations',                                     locationRoutes);
  app.use('/api/locations/:locationId/agents',                  agentRoutes);
  app.use('/api/locations/:locationId/calls',                   callRoutes);

  // Analyze routes share the same location+call prefix but have two patterns:
  //   POST /api/locations/:locationId/calls/:callId/analyze
  //   GET  /api/locations/:locationId/calls/:callId/analysis
  //   POST /api/locations/:locationId/analyze-pending
  app.use('/api/locations/:locationId/calls',                   analyzeRoutes);
  app.use('/api/locations/:locationId',                         analyzeRoutes);  // /analyze-pending

  app.use('/api/locations/:locationId/dashboard',               dashboardRoutes);

  // ─── 404 for unknown API routes ─────────────────────────────────────────
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API route not found' });
  });

  // ─── SPA fallback — send index.html for all other GET requests ──────────
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // ─── Global error handler ───────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    log.error('Unhandled error:', err.message, err.stack);
    const status = err.status ?? err.statusCode ?? 500;
    res.status(status).json({ ok: false, error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
