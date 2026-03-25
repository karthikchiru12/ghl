'use strict';

const { chatComplete, extractJson } = require('../lib/chutes');
const { getCallDetail } = require('./callLogs');
const { getAgentDetail } = require('./voiceAgents');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');
const { logEvent } = require('./activityLog');

const log = createLogger('analysis');

function parseJsonValue(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  return value;
}

function omitKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key))
  );
}

/**
 * Build the LLM analysis messages for Minimax M2.5.
 * Returns the messages array for the chat completion request.
 */
function buildAnalysisMessages(call, agent) {
  const transcriptEntries = parseJsonValue(call.transcript, []);
  const transcriptText = (() => {
    if (Array.isArray(transcriptEntries) && transcriptEntries.length > 0) {
      return transcriptEntries
        .map((m) => `${m.role ?? m.speaker ?? 'unknown'}: ${m.content ?? m.message ?? ''}`)
        .join('\n');
    }
    return call.transcript_text || 'No transcript available.';
  })();

  const configuredActions = parseJsonValue(agent?.actions, []);
  const executedActions = parseJsonValue(call.executed_actions, []);
  const extractedData = parseJsonValue(call.extracted_data, null);
  const translation = parseJsonValue(call.translation, null);
  const agentRaw = parseJsonValue(agent?.raw, {});
  const callRaw = parseJsonValue(call.raw, {});

  const agentContext = agent ? {
    id: agent.agent_id ?? agentRaw.id ?? null,
    locationId: agent.location_id ?? agentRaw.locationId ?? call.location_id ?? null,
    agentName: agent.name ?? agentRaw.agentName ?? null,
    businessName: agent.business_name ?? agentRaw.businessName ?? null,
    welcomeMessage: agent.welcome_message ?? agentRaw.welcomeMessage ?? null,
    agentPrompt: agent.prompt ?? agent.script ?? agentRaw.agentPrompt ?? null,
    voiceId: agent.voice_id ?? agentRaw.voiceId ?? null,
    language: agent.language ?? agentRaw.language ?? null,
    patienceLevel: agent.patience_level ?? agentRaw.patienceLevel ?? null,
    maxCallDuration: agent.max_call_duration ?? agentRaw.maxCallDuration ?? null,
    sendUserIdleReminders: agent.metadata?.sendUserIdleReminders ?? agentRaw.sendUserIdleReminders ?? null,
    reminderAfterIdleTimeSeconds:
      agent.metadata?.reminderAfterIdleTimeSeconds ?? agentRaw.reminderAfterIdleTimeSeconds ?? null,
    inboundNumber: agent.metadata?.inboundNumber ?? agentRaw.inboundNumber ?? null,
    numberPoolId: agent.metadata?.numberPoolId ?? agentRaw.numberPoolId ?? null,
    callEndWorkflowIds: agent.call_end_workflow_ids ?? agentRaw.callEndWorkflowIds ?? [],
    agentWorkingHours: agent.working_hours ?? agentRaw.agentWorkingHours ?? [],
    timezone: agent.timezone ?? agentRaw.timezone ?? null,
    isAgentAsBackupDisabled:
      agent.metadata?.isAgentAsBackupDisabled ?? agentRaw.isAgentAsBackupDisabled ?? null,
    translation: agent.metadata?.translation ?? agentRaw.translation ?? null,
    actions: configuredActions,
    recentCalls: parseJsonValue(agent.recent_calls, []),
    rawExtraFields: omitKeys(agentRaw, [
      'id',
      'locationId',
      'agentName',
      'businessName',
      'welcomeMessage',
      'agentPrompt',
      'voiceId',
      'language',
      'patienceLevel',
      'maxCallDuration',
      'sendUserIdleReminders',
      'reminderAfterIdleTimeSeconds',
      'inboundNumber',
      'numberPoolId',
      'callEndWorkflowIds',
      'agentWorkingHours',
      'timezone',
      'isAgentAsBackupDisabled',
      'translation',
      'actions',
    ]),
  } : null;

  const callContext = {
    id: call.call_id ?? callRaw.id ?? null,
    locationId: call.location_id ?? null,
    contactId: call.contact_id ?? callRaw.contactId ?? null,
    agentId: call.agent_id ?? callRaw.agentId ?? null,
    isAgentDeleted: callRaw.isAgentDeleted ?? null,
    fromNumber: call.from_number ?? callRaw.fromNumber ?? null,
    createdAt: call.started_at ?? callRaw.createdAt ?? null,
    durationSeconds: call.duration_seconds ?? callRaw.duration ?? null,
    trialCall: call.trial_call ?? callRaw.trialCall ?? null,
    status: call.status ?? null,
    messageId: call.message_id ?? callRaw.messageId ?? null,
    summary: call.summary ?? callRaw.summary ?? null,
    extractedData,
    translation,
    executedCallActions: executedActions,
    transcriptText,
    transcriptTurns: Array.isArray(transcriptEntries) ? transcriptEntries : [],
    rawExtraFields: omitKeys(callRaw, [
      'id',
      'contactId',
      'agentId',
      'isAgentDeleted',
      'fromNumber',
      'createdAt',
      'duration',
      'trialCall',
      'executedCallActions',
      'summary',
      'transcript',
      'translation',
      'extractedData',
      'messageId',
    ]),
  };

  const systemPrompt = `You are an expert Voice AI quality analyst. Analyse the provided call transcript against the agent's goals and success criteria. Return ONLY a valid JSON object — no markdown, no explanation — matching this exact schema:

{
  "success": boolean,
  "score": integer between 0 and 100,
  "summary_text": "2-3 sentence operator summary of what happened and why it matters",
  "failures": ["list of specific failures or policy violations"],
  "missed_opportunities": ["list of missed upsell/engagement opportunities"],
  "use_actions": ["segments or moments requiring human intervention or escalation"],
  "transcript_highlights": [
    {
      "speaker": "agent|user",
      "moment": "short quote or timestamp-like locator",
      "reason": "why it matters"
    }
  ],
  "prompt_recommendations": ["specific changes to improve the agent prompt"],
  "script_recommendations": ["specific changes to improve the agent script or flow"],
  "action_recommendations": ["specific changes to improve configured actions or action triggers"],
  "metrics": {
    "sentiment_overall": float between -1.0 (very negative) and 1.0 (very positive),
    "sentiment_start": float — customer sentiment at call opening,
    "sentiment_end": float — customer sentiment at call closing,
    "resolution_detected": boolean — was the customer's issue fully resolved,
    "talk_listen_ratio": float 0-1 — proportion of agent words to total words,
    "customer_effort": integer 1-5 — effort customer expended (1=effortless 5=extreme),
    "empathy_score": integer 0-100 — how well agent acknowledged emotions and showed understanding,
    "script_adherence": integer 0-100 — how closely agent followed its defined script/flow,
    "call_category": string — primary reason: "support"|"sales"|"billing"|"inquiry"|"complaint"|"scheduling"|"other"
  }
}`;

  const userMessage = `## Agent Context
${agentContext ? JSON.stringify(agentContext, null, 2) : 'No agent metadata available.'}

## Call Metadata
${JSON.stringify(callContext, null, 2)}

## Transcript
${transcriptText}

## Task
Evaluate this call. Use the complete agent configuration, action parameters, executed call actions, extracted data, and call-log metadata as the evaluation baseline. Highlight where the prompt, action wiring, or routing and working-hours configuration is misaligned with the observed call. Return strictly the JSON schema defined in your instructions.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage },
  ];
}

/**
 * Analyse a single call using Chutes Minimax M2.5.
 * Persists the result in call_analyses and returns the analysis row.
 *
 * @param {string} callId
 * @param {string} locationId
 * @returns {Promise<object>}
 */
async function analyseCall(callId, locationId) {
  log.info('Analysing call:', callId);

  const call = await getCallDetail(callId, locationId, { refresh: true });
  if (!call) throw Object.assign(new Error(`Call not found: ${callId}`), { status: 404 });

  // Fetch full live agent detail so the analysis has current prompt/actions.
  let agent = null;
  if (call.agent_id) {
    agent = await getAgentDetail(call.agent_id, locationId, { refresh: true });
  }

  const messages = buildAnalysisMessages(call, agent);
  const raw = await chatComplete(messages, { maxTokens: 2000, temperature: 0.15 });

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    log.error('Failed to parse LLM JSON response:', raw.slice(0, 300));
    throw new Error(`LLM returned malformed JSON: ${e.message}`);
  }

  // Enforce schema shape and bounds
  const metrics = parsed.metrics && typeof parsed.metrics === 'object' ? {
    sentiment_overall:   Number(parsed.metrics.sentiment_overall  ?? 0),
    sentiment_start:     Number(parsed.metrics.sentiment_start    ?? 0),
    sentiment_end:       Number(parsed.metrics.sentiment_end      ?? 0),
    resolution_detected: Boolean(parsed.metrics.resolution_detected),
    talk_listen_ratio:   Math.min(1, Math.max(0, Number(parsed.metrics.talk_listen_ratio ?? 0.5))),
    customer_effort:     Math.min(5, Math.max(1, Number(parsed.metrics.customer_effort   ?? 3))),
    empathy_score:       Math.min(100, Math.max(0, Number(parsed.metrics.empathy_score   ?? 50))),
    script_adherence:    Math.min(100, Math.max(0, Number(parsed.metrics.script_adherence ?? 50))),
    call_category:       String(parsed.metrics.call_category ?? 'other'),
  } : {};

  const result = {
    success:                Boolean(parsed.success),
    score:                  Math.min(100, Math.max(0, Number(parsed.score ?? 50))),
    summary_text:           String(parsed.summary_text ?? '').trim(),
    failures:               Array.isArray(parsed.failures)               ? parsed.failures               : [],
    missed_opportunities:   Array.isArray(parsed.missed_opportunities)   ? parsed.missed_opportunities   : [],
    use_actions:            Array.isArray(parsed.use_actions)            ? parsed.use_actions            : [],
    transcript_highlights:  Array.isArray(parsed.transcript_highlights)  ? parsed.transcript_highlights  : [],
    prompt_recommendations: Array.isArray(parsed.prompt_recommendations) ? parsed.prompt_recommendations : [],
    script_recommendations: Array.isArray(parsed.script_recommendations) ? parsed.script_recommendations : [],
    action_recommendations: Array.isArray(parsed.action_recommendations) ? parsed.action_recommendations : [],
    metrics,
  };

  const agentRawSnapshot = parseJsonValue(agent?.raw, {});
  const agentSnapshot = agent
    ? {
        agentId: agent.agent_id ?? call.agent_id ?? null,
        name: agent.name ?? null,
        locationId: agent.location_id ?? agentRawSnapshot.locationId ?? locationId,
        businessName: agent.business_name ?? null,
        welcomeMessage: agent.welcome_message ?? null,
        prompt: agent.prompt ?? agent.script ?? null,
        actions: agent.actions ?? [],
        recentCalls: parseJsonValue(agent.recent_calls, []),
        metadata: {
          voiceId: agent.voice_id ?? null,
          language: agent.language ?? null,
          patienceLevel: agent.patience_level ?? null,
          maxCallDuration: agent.max_call_duration ?? null,
          sendUserIdleReminders:
            agent.metadata?.sendUserIdleReminders ?? agentRawSnapshot.sendUserIdleReminders ?? null,
          reminderAfterIdleTimeSeconds:
            agent.metadata?.reminderAfterIdleTimeSeconds ?? agentRawSnapshot.reminderAfterIdleTimeSeconds ?? null,
          inboundNumber: agent.metadata?.inboundNumber ?? agentRawSnapshot.inboundNumber ?? null,
          numberPoolId: agent.metadata?.numberPoolId ?? agentRawSnapshot.numberPoolId ?? null,
          timezone: agent.timezone ?? null,
          callEndWorkflowIds: agent.call_end_workflow_ids ?? agentRawSnapshot.callEndWorkflowIds ?? [],
          agentWorkingHours: agent.working_hours ?? agentRawSnapshot.agentWorkingHours ?? [],
          isAgentAsBackupDisabled:
            agent.metadata?.isAgentAsBackupDisabled ?? agentRawSnapshot.isAgentAsBackupDisabled ?? null,
          translation: agent.metadata?.translation ?? agentRawSnapshot.translation ?? null,
        },
        rawExtraFields: omitKeys(agentRawSnapshot, [
          'id',
          'locationId',
          'agentName',
          'businessName',
          'welcomeMessage',
          'agentPrompt',
          'voiceId',
          'language',
          'patienceLevel',
          'maxCallDuration',
          'sendUserIdleReminders',
          'reminderAfterIdleTimeSeconds',
          'inboundNumber',
          'numberPoolId',
          'callEndWorkflowIds',
          'agentWorkingHours',
          'timezone',
          'isAgentAsBackupDisabled',
          'translation',
          'actions',
        ]),
      }
    : {};

  await pool.query(
    `INSERT INTO call_analyses
       (call_id, location_id, agent_id, success, score, summary_text, failures,
        missed_opportunities, use_actions, transcript_highlights, prompt_recommendations,
        script_recommendations, action_recommendations, agent_snapshot, metrics, raw_response, analyzed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,NOW())
     ON CONFLICT (call_id) DO UPDATE
       SET success                = EXCLUDED.success,
           score                  = EXCLUDED.score,
           summary_text           = EXCLUDED.summary_text,
           failures               = EXCLUDED.failures,
           missed_opportunities   = EXCLUDED.missed_opportunities,
           use_actions            = EXCLUDED.use_actions,
           transcript_highlights  = EXCLUDED.transcript_highlights,
           prompt_recommendations = EXCLUDED.prompt_recommendations,
           script_recommendations = EXCLUDED.script_recommendations,
           action_recommendations = EXCLUDED.action_recommendations,
           agent_snapshot         = EXCLUDED.agent_snapshot,
           metrics                = EXCLUDED.metrics,
           raw_response           = EXCLUDED.raw_response,
           analyzed_at            = NOW()`,
    [
      callId,
      locationId,
      call.agent_id ?? null,
      result.success,
      result.score,
      result.summary_text,
      JSON.stringify(result.failures),
      JSON.stringify(result.missed_opportunities),
      JSON.stringify(result.use_actions),
      JSON.stringify(result.transcript_highlights),
      JSON.stringify(result.prompt_recommendations),
      JSON.stringify(result.script_recommendations),
      JSON.stringify(result.action_recommendations),
      JSON.stringify(agentSnapshot),
      JSON.stringify(result.metrics),
      raw,
    ]
  );

  log.info(`Analysis complete for call ${callId} — score: ${result.score}, success: ${result.success}`);
  await logEvent({
    locationId,
    eventType: 'analysis.completed',
    status: result.success ? 'success' : 'warn',
    title: 'Call analysis completed',
    detail: `${callId} scored ${result.score}`,
    payload: {
      callId,
      agentId: call.agent_id ?? null,
      score: result.score,
      success: result.success,
    },
  });
  return { callId, locationId, ...result };
}

/**
 * Analyse pending call_logs for a location (no existing analysis).
 * Processes calls in batches of 3 concurrently to balance throughput and rate limits.
 *
 * @param {string} locationId
 * @param {{ limit?: number, agentId?: string | null }} [opts]
 * @returns {Promise<Array>}
 */
async function analysePendingCalls(locationId, { limit = 20, agentId = null } = {}) {
  const values = [locationId];
  let predicate = 'cl.location_id = $1';

  if (agentId) {
    values.push(agentId);
    predicate += ` AND cl.agent_id = $${values.length}`;
  }

  values.push(limit);
  const pending = await pool.query(
    `SELECT cl.call_id FROM call_logs cl
     LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
     WHERE ${predicate} AND ca.call_id IS NULL
     ORDER BY cl.started_at DESC
     LIMIT $${values.length}`,
    values
  );

  log.info(
    `Analysing ${pending.rows.length} pending calls for location:`,
    locationId,
    agentId ? `(agent ${agentId})` : ''
  );

  const results = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < pending.rows.length; i += CONCURRENCY) {
    const batch = pending.rows.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((row) => analyseCall(row.call_id, locationId))
    );
    settled.forEach((outcome, idx) => {
      const callId = batch[idx].call_id;
      if (outcome.status === 'fulfilled') {
        results.push({ callId, ok: true, score: outcome.value.score });
      } else {
        log.error(`Failed to analyse call ${callId}:`, outcome.reason.message);
        results.push({ callId, ok: false, error: outcome.reason.message });
      }
    });
  }

  return results;
}

module.exports = { analyseCall, analysePendingCalls };
