'use strict';

const { highLevel } = require('../lib/ghl');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('voiceAgents');

/**
 * Build SDK options that inject the per-location bearer token.
 * The SDK's VoiceAi service uses 'bearer' security, which falls back to
 * session storage. We pass the resolved token explicitly so the correct
 * location token is used even in a multi-tenant setup.
 */
async function sdkOptions(locationId) {
  const token = await highLevel.getAuthToken(locationId);
  if (!token) {
    throw Object.assign(
      new Error(`No auth token for location ${locationId}. App must be installed first.`),
      { status: 401 }
    );
  }
  return { headers: { Authorization: token } };
}

/**
 * Sync Voice AI agents from GHL via the SDK, upsert into voice_agents, return DB rows.
 *
 * @param {string} locationId
 * @param {{ page?: number, pageSize?: number }} [pagination]
 * @returns {Promise<Array>}
 */
async function syncAgents(locationId, { page = 1, pageSize = 50 } = {}) {
  log.info('Syncing Voice AI agents via SDK for location:', locationId);

  const opts = await sdkOptions(locationId);
  const data = await highLevel.voiceAi.getAgents({ locationId, page, pageSize }, opts);

  // SDK response shape: { total, page, pageSize, agents: [...] }
  const agents = data?.agents ?? [];
  log.info(`Fetched ${agents.length} agent(s) (total: ${data?.total ?? '?'}) for location:`, locationId);

  for (const agent of agents) {
    await pool.query(
      `INSERT INTO voice_agents
         (agent_id, location_id, name, status, goals, script, raw, synced_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, NOW())
       ON CONFLICT (agent_id) DO UPDATE
         SET location_id = EXCLUDED.location_id,
             name        = EXCLUDED.name,
             status      = EXCLUDED.status,
             goals       = EXCLUDED.goals,
             script      = EXCLUDED.script,
             raw         = EXCLUDED.raw,
             synced_at   = NOW()`,
      [
        agent.id,
        agent.locationId ?? locationId,
        agent.agentName  ?? null,
        agent.status     ?? null,
        // goals/KPIs live in agentPrompt + actions for analysis context
        JSON.stringify({ prompt: agent.agentPrompt, actions: agent.actions ?? [] }),
        agent.agentPrompt ?? null,
        JSON.stringify(agent),
      ]
    );
  }

  return getAgentsByLocation(locationId);
}

/**
 * Return cached agents from DB for a location (no GHL call).
 */
async function getAgentsByLocation(locationId) {
  const result = await pool.query(
    `SELECT agent_id, location_id, name, status, goals, script, synced_at
     FROM voice_agents WHERE location_id = $1 ORDER BY name`,
    [locationId]
  );
  return result.rows;
}

/**
 * Fetch a single agent's full detail from the SDK (including actions).
 */
async function getAgentDetail(agentId, locationId) {
  const opts = await sdkOptions(locationId);
  return highLevel.voiceAi.getAgent({ agentId, locationId }, opts);
}

module.exports = { syncAgents, getAgentsByLocation, getAgentDetail, sdkOptions };
