'use strict';

const { highLevel } = require('../lib/ghl');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');
const { logEvent } = require('./activityLog');

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

async function upsertAgentRecord(agent, locationId) {
  await pool.query(
    `INSERT INTO voice_agents
       (agent_id, location_id, name, status, goals, script, business_name, welcome_message,
        prompt, voice_id, language, patience_level, max_call_duration, timezone,
        call_end_workflow_ids, working_hours, actions, metadata, raw, synced_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, NOW())
     ON CONFLICT (agent_id) DO UPDATE
       SET location_id = EXCLUDED.location_id,
           name        = EXCLUDED.name,
           status      = EXCLUDED.status,
           goals       = EXCLUDED.goals,
           script      = EXCLUDED.script,
           business_name = EXCLUDED.business_name,
           welcome_message = EXCLUDED.welcome_message,
           prompt      = EXCLUDED.prompt,
           voice_id    = EXCLUDED.voice_id,
           language    = EXCLUDED.language,
           patience_level = EXCLUDED.patience_level,
           max_call_duration = EXCLUDED.max_call_duration,
           timezone    = EXCLUDED.timezone,
           call_end_workflow_ids = EXCLUDED.call_end_workflow_ids,
           working_hours = EXCLUDED.working_hours,
           actions     = EXCLUDED.actions,
           metadata    = EXCLUDED.metadata,
           raw         = EXCLUDED.raw,
           synced_at   = NOW()`,
    [
      agent.id,
      agent.locationId ?? locationId,
      agent.agentName ?? null,
      agent.status ?? null,
      JSON.stringify({
        agentPrompt: agent.agentPrompt ?? null,
        welcomeMessage: agent.welcomeMessage ?? null,
        businessName: agent.businessName ?? null,
        actions: agent.actions ?? [],
      }),
      agent.agentPrompt ?? null,
      agent.businessName ?? null,
      agent.welcomeMessage ?? null,
      agent.agentPrompt ?? null,
      agent.voiceId ?? null,
      agent.language ?? null,
      agent.patienceLevel ?? null,
      agent.maxCallDuration ?? null,
      agent.timezone ?? null,
      JSON.stringify(agent.callEndWorkflowIds ?? []),
      JSON.stringify(agent.agentWorkingHours ?? []),
      JSON.stringify(agent.actions ?? []),
      JSON.stringify({
        sendUserIdleReminders: agent.sendUserIdleReminders ?? null,
        reminderAfterIdleTimeSeconds: agent.reminderAfterIdleTimeSeconds ?? null,
        inboundNumber: agent.inboundNumber ?? null,
        numberPoolId: agent.numberPoolId ?? null,
        isAgentAsBackupDisabled: agent.isAgentAsBackupDisabled ?? null,
        translation: agent.translation ?? null,
      }),
      JSON.stringify(agent),
    ]
  );
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
    await upsertAgentRecord(agent, locationId);
  }

  await logEvent({
    locationId,
    eventType: 'voice-agents.sync',
    status: 'success',
    title: 'Voice agents synced',
    detail: `${agents.length} agent(s) refreshed from HighLevel`,
    payload: { page, pageSize, total: data?.total ?? agents.length },
  });

  return getAgentsByLocation(locationId);
}

/**
 * Return cached agents from DB for a location (no GHL call).
 */
async function getAgentsByLocation(locationId) {
  const result = await pool.query(
    `SELECT
       va.agent_id,
       va.location_id,
       va.name,
       va.status,
       va.business_name,
       va.welcome_message,
       va.prompt,
       va.voice_id,
       va.language,
       va.patience_level,
       va.max_call_duration,
       va.timezone,
       va.actions,
       va.metadata,
       va.synced_at,
       COUNT(cl.call_id) AS total_calls,
       COUNT(ca.call_id) AS analysed_calls,
       AVG(ca.score)::NUMERIC(5,1) AS avg_score,
       MAX(cl.started_at) AS last_call_at
     FROM voice_agents va
     LEFT JOIN call_logs cl ON cl.agent_id = va.agent_id
     LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
     WHERE va.location_id = $1
     GROUP BY va.agent_id
     ORDER BY COALESCE(va.name, va.agent_id)`,
    [locationId]
  );
  return result.rows.map((row) => ({
    ...row,
    total_calls: Number(row.total_calls ?? 0),
    analysed_calls: Number(row.analysed_calls ?? 0),
    avg_score: row.avg_score == null ? null : Number(row.avg_score),
  }));
}

/**
 * Fetch a single agent's full detail from the SDK (including actions).
 */
async function getAgentDetail(agentId, locationId, { refresh = false } = {}) {
  if (refresh) {
    const opts = await sdkOptions(locationId);
    const live = await highLevel.voiceAi.getAgent({ agentId, locationId }, opts);
    if (!live?.id) return null;
    await upsertAgentRecord(live, locationId);
  }

  const cached = await pool.query(
    `SELECT
       va.*,
       COALESCE(
         jsonb_agg(
           DISTINCT jsonb_build_object(
             'callId', cl.call_id,
             'startedAt', cl.started_at,
             'summary', cl.summary,
             'durationSeconds', cl.duration_seconds,
             'score', ca.score,
             'success', ca.success
           )
         ) FILTER (WHERE cl.call_id IS NOT NULL),
         '[]'::jsonb
       ) AS recent_calls
     FROM voice_agents va
     LEFT JOIN call_logs cl ON cl.agent_id = va.agent_id
     LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
     WHERE va.agent_id = $1 AND va.location_id = $2
     GROUP BY va.agent_id
     LIMIT 1`,
    [agentId, locationId]
  );

  if (cached.rows[0]) return cached.rows[0];

  const opts = await sdkOptions(locationId);
  const live = await highLevel.voiceAi.getAgent({ agentId, locationId }, opts);
  if (!live?.id) return null;
  await upsertAgentRecord(live, locationId);
  return {
    ...live,
    recent_calls: [],
  };
}

module.exports = { syncAgents, getAgentsByLocation, getAgentDetail, sdkOptions };
