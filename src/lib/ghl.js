'use strict';

/**
 * GHL SDK singleton.
 *
 * SDK v2.2.2 covers all endpoints needed for this project:
 *   highLevel.voiceAi.getAgents()    → /voice-ai/agents
 *   highLevel.voiceAi.getCallLogs()  → /voice-ai/dashboard/call-logs
 *   highLevel.voiceAi.getCallLog()   → /voice-ai/dashboard/call-logs/:callId
 *   highLevel.locations.getLocation()
 *
 * All Voice AI methods accept an optional `options` arg where we inject
 * { headers: { Authorization: <location-bearer-token> } } so the correct
 * per-location token is used in a multi-tenant setup.
 */

const { HighLevel } = require('@gohighlevel/api-client');
const { sessionStorage } = require('../services/sessionStorage');
const { createLogger } = require('./logger');

const log = createLogger('ghl');

// ─── Validate environment ─────────────────────────────────────────────────────

const hasPit   = Boolean(process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN);
const hasOAuth = ['HIGHLEVEL_CLIENT_ID', 'HIGHLEVEL_CLIENT_SECRET', 'HIGHLEVEL_REDIRECT_URI']
  .every((k) => Boolean(process.env[k]));

if (!hasPit && !hasOAuth) {
  throw new Error(
    'Set HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN or all three OAuth vars: ' +
    'HIGHLEVEL_CLIENT_ID, HIGHLEVEL_CLIENT_SECRET, HIGHLEVEL_REDIRECT_URI'
  );
}

// ─── SDK Singleton ────────────────────────────────────────────────────────────

const ghlConfig = hasPit
  ? { privateIntegrationToken: process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN, sessionStorage }
  : {
      clientId:     process.env.HIGHLEVEL_CLIENT_ID,
      clientSecret: process.env.HIGHLEVEL_CLIENT_SECRET,
      sessionStorage,
    };

const highLevel = new HighLevel(ghlConfig);

log.info('HighLevel SDK v2 initialised — authMode:', hasPit ? 'private-integration-token' : 'oauth');

module.exports = { highLevel, hasPit };
