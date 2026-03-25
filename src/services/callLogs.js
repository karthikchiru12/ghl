'use strict';

const { highLevel } = require('../lib/ghl');
const { sdkOptions } = require('./voiceAgents');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');
const { logEvent } = require('./activityLog');

const log = createLogger('callLogs');

/**
 * Map a GHL CallLogDTO (SDK shape) to our DB columns.
 *
 * SDK CallLogDTO:
 *   id, contactId, agentId, isAgentDeleted, fromNumber, createdAt,
 *   duration, trialCall, executedCallActions, summary, transcript,
 *   translation, extractedData, messageId
 *
 *  Note: there is no startedAt/endedAt in the SDK model; `createdAt` is
 *  the call start time and `duration` is in seconds.
 */
/**
 * Try to split a raw transcript string like "bot:Hello human:Hi bot:How can I help?"
 * into structured [{role, content}] turns. Falls back to a single 'raw' entry.
 */
function parseTranscriptString(text) {
  // Match turn boundaries: "bot:", "human:", "agent:", "user:", "assistant:", "contact:" etc.
  const turnPattern = /(?:^|\n)\s*(bot|human|agent|user|assistant|contact|ai|system)\s*:/i;
  if (!turnPattern.test(text)) return [{ role: 'raw', content: text }];

  const turns = [];
  // Split on role prefixes while keeping the delimiter
  const parts = text.split(/((?:^|\n)\s*(?:bot|human|agent|user|assistant|contact|ai|system)\s*:)/i);

  for (let i = 1; i < parts.length; i += 2) {
    const roleRaw = parts[i].replace(/[\n:]/g, '').trim().toLowerCase();
    const content = (parts[i + 1] ?? '').trim();
    if (!content) continue;

    // Normalise role names to agent/user for consistent bubble styling
    const role = ['bot', 'agent', 'assistant', 'ai'].includes(roleRaw) ? 'agent' : 'user';
    turns.push({ role, content });
  }

  return turns.length > 0 ? turns : [{ role: 'raw', content: text }];
}

function normaliseCall(raw, locationId) {
  const transcriptText = typeof raw.transcript === 'string'
    ? raw.transcript
    : Array.isArray(raw.transcript)
      ? raw.transcript.map((entry) => `${entry.role ?? entry.speaker ?? 'unknown'}: ${entry.content ?? ''}`).join('\n')
      : null;

  const transcript = typeof raw.transcript === 'string' && raw.transcript.trim()
    ? parseTranscriptString(raw.transcript)
    : Array.isArray(raw.transcript)
      ? raw.transcript
      : null;

  return {
    callId:          raw.id,
    agentId:         raw.agentId         ?? null,
    locationId,
    contactId:       raw.contactId       ?? null,
    fromNumber:      raw.fromNumber      ?? null,
    transcript:      transcript          ? JSON.stringify(transcript) : null,
    transcriptText,
    summary:         raw.summary         ?? null,
    extractedData:   JSON.stringify(raw.extractedData  ?? null),
    executedActions: JSON.stringify(raw.executedCallActions ?? null),
    durationSeconds: raw.duration        ?? null,
    status:          raw.trialCall ? 'trial' : 'completed',
    trialCall:       Boolean(raw.trialCall),
    translation:     JSON.stringify(raw.translation ?? null),
    messageId:       raw.messageId ?? null,
    startedAt:       raw.createdAt       ?? null,
    endedAt:         null,  // not provided by GHL SDK
    raw:             JSON.stringify(raw),
  };
}

async function upsertCall(c) {
  await pool.query(
    `INSERT INTO call_logs
       (call_id, agent_id, location_id, contact_id, from_number, transcript, transcript_text, summary,
        extracted_data, executed_actions, duration_seconds, status, trial_call, translation, message_id,
        started_at, ended_at, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::jsonb,NOW())
     ON CONFLICT (call_id) DO UPDATE
       SET agent_id          = EXCLUDED.agent_id,
           contact_id        = EXCLUDED.contact_id,
           from_number       = EXCLUDED.from_number,
           transcript        = EXCLUDED.transcript,
           transcript_text   = EXCLUDED.transcript_text,
           summary           = EXCLUDED.summary,
           extracted_data    = EXCLUDED.extracted_data,
           executed_actions  = EXCLUDED.executed_actions,
           duration_seconds  = EXCLUDED.duration_seconds,
           status            = EXCLUDED.status,
           trial_call        = EXCLUDED.trial_call,
           translation       = EXCLUDED.translation,
           message_id        = EXCLUDED.message_id,
           started_at        = EXCLUDED.started_at,
           raw               = EXCLUDED.raw,
           synced_at         = NOW()`,
    [
      c.callId, c.agentId, c.locationId, c.contactId, c.fromNumber,
      c.transcript, c.transcriptText, c.summary, c.extractedData, c.executedActions,
      c.durationSeconds, c.status, c.trialCall, c.translation, c.messageId,
      c.startedAt, c.endedAt, c.raw,
    ]
  );
}

/**
 * Fetch call logs from GHL via the SDK voiceAi.getCallLogs(), persist, and return.
 *
 * @param {string} locationId
 * @param {{ agentId?, page?, pageSize? }} [opts]
 */
async function syncCallLogs(locationId, { agentId, page = 1, pageSize = 50 } = {}) {
  log.info('Syncing call logs via SDK for location:', locationId);

  const opts = await sdkOptions(locationId);
  const params = { locationId, page, pageSize };
  if (agentId) params.agentId = agentId;

  // SDK endpoint: GET /voice-ai/dashboard/call-logs
  const data = await highLevel.voiceAi.getCallLogs(params, opts);

  // SDK shape: { total, page, pageSize, callLogs: [...] }
  const calls = data?.callLogs ?? [];
  log.info(`Fetched ${calls.length} call(s) (total: ${data?.total ?? '?'}) for location:`, locationId);

  for (const raw of calls) {
    if (!raw.id) { log.warn('Skipping call with no id'); continue; }
    const c = normaliseCall(raw, locationId);
    await upsertCall(c);
  }

  await logEvent({
    locationId,
    eventType: 'voice-calls.sync',
    status: 'success',
    title: 'Voice call logs synced',
    detail: `${calls.length} call(s) refreshed from HighLevel`,
    payload: { page, pageSize, total: data?.total ?? calls.length, agentId: agentId ?? null },
  });

  return getCallsByLocation(locationId, { agentId, page, pageSize });
}

/**
 * Return stored call logs from DB, joined with any analysis results.
 */
async function getCallsByLocation(locationId, { agentId, page = 1, pageSize = 50 } = {}) {
  const offset = (page - 1) * pageSize;
  const values = [locationId, pageSize, offset];
  let query = `
    SELECT
      cl.call_id, cl.agent_id, cl.location_id, cl.contact_id, cl.from_number, cl.summary,
      cl.duration_seconds, cl.status, cl.trial_call, cl.message_id, cl.started_at, cl.synced_at,
      va.name AS agent_name,
      ca.score, ca.success, ca.analyzed_at
    FROM call_logs cl
    LEFT JOIN voice_agents va ON va.agent_id = cl.agent_id
    LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
    WHERE cl.location_id = $1`;

  if (agentId) {
    values.push(agentId);
    query += ` AND cl.agent_id = $${values.length}`;
  }

  query += ` ORDER BY cl.started_at DESC NULLS LAST LIMIT $2 OFFSET $3`;

  const result = await pool.query(query, values);
  return result.rows;
}

/**
 * Return a single call with full transcript (DB first, then SDK if missing).
 */
async function getCallDetail(callId, locationId) {
  const cached = await pool.query(
    `SELECT
       cl.*,
       va.name AS agent_name,
       va.prompt AS agent_prompt,
       va.actions AS agent_actions
     FROM call_logs cl
     LEFT JOIN voice_agents va ON va.agent_id = cl.agent_id
     WHERE cl.call_id = $1 AND cl.location_id = $2
     LIMIT 1`,
    [callId, locationId]
  );
  if (cached.rows.length > 0) return cached.rows[0];

  // Not cached — fetch from GHL SDK
  log.info('Call not in DB, fetching via SDK:', callId);
  const opts = await sdkOptions(locationId);
  const raw  = await highLevel.voiceAi.getCallLog({ callId, locationId }, opts);

  if (!raw?.id) return null;
  const c = normaliseCall(raw, locationId);
  await upsertCall(c);

  const fresh = await pool.query(
    `SELECT
       cl.*,
       va.name AS agent_name,
       va.prompt AS agent_prompt,
       va.actions AS agent_actions
     FROM call_logs cl
     LEFT JOIN voice_agents va ON va.agent_id = cl.agent_id
     WHERE cl.call_id = $1 AND cl.location_id = $2
     LIMIT 1`,
    [callId, locationId]
  );
  return fresh.rows[0] ?? null;
}

module.exports = { syncCallLogs, getCallsByLocation, getCallDetail, normaliseCall, parseTranscriptString, upsertCall };
