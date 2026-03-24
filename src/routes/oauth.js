'use strict';

const { Router } = require('express');
const { highLevel, hasPit } = require('../lib/ghl');
const { sessionStorage } = require('../services/sessionStorage');
const { createLogger } = require('../lib/logger');
const axios = require('axios');

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

// GET /oauth/callback
// GHL redirects here after the user authorises the app.
// We MUST exchange the one-time `code` for an access token here.
// The token returned for a Location install is a location-scoped token —
// we store it directly under the locationId so all subsequent SDK calls work.
router.get('/oauth/callback', async (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;

  if (error) {
    log.warn('OAuth callback error:', error, errorDescription);
    return res.status(400).json({ ok: false, error, errorDescription });
  }

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Missing code query parameter' });
  }

  try {
    log.info('OAuth callback: exchanging code for access token...');

    // GHL token endpoint requires application/x-www-form-urlencoded
    const { data } = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      new URLSearchParams({
        client_id:     process.env.HIGHLEVEL_CLIENT_ID,
        client_secret: process.env.HIGHLEVEL_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.HIGHLEVEL_REDIRECT_URI,
        user_type:     'Location',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    log.info('Token exchange succeeded. userType:', data.userType, 'locationId:', data.locationId);

    // Store under locationId (location-scoped token) AND companyId (agency token)
    // so the SDK's generateLocationAccessToken can find a company token if needed.
    if (data.locationId) {
      await sessionStorage.setSession(data.locationId, data);
      log.info('Location token stored for:', data.locationId);
    }
    if (data.companyId) {
      await sessionStorage.setSession(data.companyId, data);
      log.info('Company token stored for:', data.companyId);
    }

    // Redirect to dashboard instead of showing raw JSON
    return res.redirect('/?installed=1');
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    log.error('Token exchange failed:', detail);
    return res.status(500).json({ ok: false, error: 'Token exchange failed', detail });
  }
});

module.exports = router;
