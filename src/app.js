'use strict';

const path    = require('path');
const express = require('express');
const { initDb }   = require('./db/init');
const { pool }     = require('./db/pool');
const { createLogger } = require('./lib/logger');
const { resolveRequestContext, requireLocationAccess } = require('./middleware/locationAccess');

// Route modules
const oauthRoutes     = require('./routes/oauth');
const webhookRoutes   = require('./routes/webhooks');
const agentRoutes     = require('./routes/agents');
const callRoutes      = require('./routes/calls');
const analyzeRoutes   = require('./routes/analyze');
const dashboardRoutes = require('./routes/dashboard');

const log = createLogger('app');

function isAllowedEmbedOrigin(origin) {
  if (!origin) return false;

  const allowedOrigins = (process.env.HIGHLEVEL_EMBED_ALLOWED_ORIGINS || 'https://app.gohighlevel.com')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedOrigins.some((allowed) => {
    if (allowed === origin) return true;
    if (allowed.startsWith('*.')) {
      return origin.endsWith(allowed.slice(1));
    }
    return false;
  });
}

// The GHL SDK WebhookManager internally reads process.env.CLIENT_ID (not our
// HIGHLEVEL_CLIENT_ID prefix) to derive appId for INSTALL event matching.
// Without this alias the SDK silently skips token persistence on every webhook.
if (process.env.HIGHLEVEL_CLIENT_ID && !process.env.CLIENT_ID) {
  process.env.CLIENT_ID = process.env.HIGHLEVEL_CLIENT_ID;
}

async function createApp() {
  // ─── DB initialisation (idempotent table creation) ─────────────────────
  await initDb();

  const app = express();

  app.use((req, res, next) => {
    const origin = req.get('origin');

    if (isAllowedEmbedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ghl-context');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  });

  // ─── Body parsing ───────────────────────────────────────────────────────
  // The GHL SDK WebhookManager surprisingly expects req.body to be parsed already,
  // as it re-stringifies it internally for HMAC verification.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(resolveRequestContext);

  app.use('/webhooks/ghl', webhookRoutes);

  // ─── Serve server-hosted HighLevel embed assets ───────────────────────
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ─── Health & info ──────────────────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, service: 'ghl-voice-ai-copilot', time: new Date().toISOString(), db: 'ok' });
    } catch (err) {
      res.status(503).json({ ok: false, service: 'ghl-voice-ai-copilot', time: new Date().toISOString(), db: 'error' });
    }
  });

  // ─── OAuth ─────────────────────────────────────────────────────────────
  app.use('/', oauthRoutes);                          // /install-url, /oauth/callback

  // ─── API — all location-scoped routes ──────────────────────────────────
  app.use('/api/locations/:locationId', requireLocationAccess);
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

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'ghl-voice-ai-copilot',
      embedScript: '/ghl-voice-ai-observability-embed.js',
    });
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
