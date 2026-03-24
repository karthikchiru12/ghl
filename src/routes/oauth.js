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
  url.searchParams.set('scope', [
    'voice-ai-dashboard.readonly',
    'voice-ai-agents.readonly',
    'voice-ai-agent-goals.readonly',
    'locations.readonly',
  ].join(' '));
  url.searchParams.set('user_type', 'Location');

  return res.json({ ok: true, installUrl: url.toString() });
});

// GET /oauth/callback  — GHL redirects here after user authorises
// Token exchange is handled by the SDK via the INSTALL webhook event.
// This endpoint just acknowledges receipt to avoid a confusing browser error.
router.get('/oauth/callback', (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    log.warn('OAuth callback error:', error, error_description);
    return res.status(400).json({ ok: false, error, error_description });
  }

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Missing code parameter' });
  }

  log.info('OAuth callback received — awaiting INSTALL webhook for token exchange');
  return res.json({
    ok: true,
    message: 'Authorisation received. Token exchange will complete via the GHL INSTALL webhook.',
    nextStep: 'Ensure your app webhook URL is set to POST /webhooks/ghl',
  });
});

module.exports = router;
