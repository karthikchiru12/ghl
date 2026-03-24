'use strict';

const { Router } = require('express');
const { highLevel, hasPit } = require('../lib/ghl');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:oauth');
const router = Router();

const oauthEnv = ['HIGHLEVEL_CLIENT_ID', 'HIGHLEVEL_CLIENT_SECRET', 'HIGHLEVEL_REDIRECT_URI'];

// GET /install-url  — returns the GHL marketplace OAuth install link
router.get('/install-url', (req, res) => {
  if (hasPit) {
    return res.status(400).json({ ok: false, error: 'Not applicable for Private Integration Token mode.' });
  }

  const missing = oauthEnv.filter((k) => !process.env[k]);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'Missing OAuth env vars', missing });
  }

  const url = new URL('https://marketplace.gohighlevel.com/oauth/chooselocation');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri',  process.env.HIGHLEVEL_REDIRECT_URI);
  url.searchParams.set('client_id',      process.env.HIGHLEVEL_CLIENT_ID);
  url.searchParams.set('scope', 'voice-ai-dashboard.readonly voice-ai-agents.readonly voice-ai-agent-goals.readonly');
  url.searchParams.set('user_type', 'Location');

  return res.json({ ok: true, installUrl: url.toString() });
});

// GET /oauth/callback  — GHL redirects here after user authorises
router.get('/oauth/callback', (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;

  if (error) {
    log.warn('OAuth callback error:', error, errorDescription);
    return res.status(400).json({ ok: false, error, errorDescription });
  }

  if (!code) {
    return res.status(400).json({ ok: false, error: "Missing code query parameter" });
  }

  log.info('OAuth callback received.');
  return res.json({
    ok: true,
    message: "Authorization completed. The SDK should receive INSTALL/UNINSTALL events on the webhook URL and manage tokens from there.",
    codeReceived: true,
    nextStep: "Configure your app's Default Webhook URL to POST to /webhooks/ghl on this service."
  });
});

module.exports = router;
