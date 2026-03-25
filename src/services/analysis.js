'use strict';

const { chatComplete, extractJson } = require('../lib/chutes');
const { getCallDetail } = require('./callLogs');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('analysis');

/**
 * Build the LLM analysis messages for Minimax M2.5.
 * Returns the messages array for the chat completion request.
 */
function buildAnalysisMessages(call, agent) {
  const transcriptText = (() => {
    if (!call.transcript) return 'No transcript available.';
    const t = typeof call.transcript === 'string'
      ? JSON.parse(call.transcript)
      : call.transcript;
    if (Array.isArray(t)) {
      return t.map((m) => `${m.role ?? m.speaker ?? 'unknown'}: ${m.content ?? m.message ?? ''}`).join('\n');
    }
    return String(t);
  })();

  const agentContext = agent
    ? `Agent name: ${agent.name ?? 'Unknown'}
Agent goals/KPIs: ${JSON.stringify(agent.goals ?? agent.successCriteria ?? 'Not provided')}
Agent script excerpt: ${(agent.script ?? 'Not provided').slice(0, 800)}`
    : 'No agent metadata available.';

  const systemPrompt = `You are an expert Voice AI quality analyst. Analyse the provided call transcript against the agent's goals and success criteria. Return ONLY a valid JSON object — no markdown, no explanation — matching this exact schema:

{
  "success": boolean,
  "score": integer between 0 and 100,
  "failures": ["list of specific failures or policy violations"],
  "missed_opportunities": ["list of missed upsell/engagement opportunities"],
  "use_actions": ["segments or moments requiring human intervention or escalation"],
  "prompt_recommendations": ["specific changes to improve the agent prompt"],
  "script_recommendations": ["specific changes to improve the agent script or flow"],
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
${agentContext}

## Call Metadata
- Call ID: ${call.call_id}
- Status: ${call.status ?? 'unknown'}
- Duration: ${call.duration_seconds ?? 'unknown'} seconds
- Summary: ${call.summary ?? 'None'}

## Transcript
${transcriptText}

## Task
Evaluate this call. Return strictly the JSON schema defined in your instructions.`;

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

  const call = await getCallDetail(callId, locationId);
  if (!call) throw Object.assign(new Error(`Call not found: ${callId}`), { status: 404 });

  // Fetch agent context if available
  let agent = null;
  if (call.agent_id) {
    const agResult = await pool.query(
      `SELECT * FROM voice_agents WHERE agent_id = $1 LIMIT 1`,
      [call.agent_id]
    );
    agent = agResult.rows[0] ?? null;
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
    failures:               Array.isArray(parsed.failures)               ? parsed.failures               : [],
    missed_opportunities:   Array.isArray(parsed.missed_opportunities)   ? parsed.missed_opportunities   : [],
    use_actions:            Array.isArray(parsed.use_actions)            ? parsed.use_actions            : [],
    prompt_recommendations: Array.isArray(parsed.prompt_recommendations) ? parsed.prompt_recommendations : [],
    script_recommendations: Array.isArray(parsed.script_recommendations) ? parsed.script_recommendations : [],
    metrics,
  };

  await pool.query(
    `INSERT INTO call_analyses
       (call_id, location_id, agent_id, success, score, failures,
        missed_opportunities, use_actions, prompt_recommendations,
        script_recommendations, metrics, raw_response, analyzed_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,NOW())
     ON CONFLICT (call_id) DO UPDATE
       SET success                = EXCLUDED.success,
           score                  = EXCLUDED.score,
           failures               = EXCLUDED.failures,
           missed_opportunities   = EXCLUDED.missed_opportunities,
           use_actions            = EXCLUDED.use_actions,
           prompt_recommendations = EXCLUDED.prompt_recommendations,
           script_recommendations = EXCLUDED.script_recommendations,
           metrics                = EXCLUDED.metrics,
           raw_response           = EXCLUDED.raw_response,
           analyzed_at            = NOW()`,
    [
      callId,
      locationId,
      call.agent_id ?? null,
      result.success,
      result.score,
      JSON.stringify(result.failures),
      JSON.stringify(result.missed_opportunities),
      JSON.stringify(result.use_actions),
      JSON.stringify(result.prompt_recommendations),
      JSON.stringify(result.script_recommendations),
      JSON.stringify(result.metrics),
      raw,
    ]
  );

  log.info(`Analysis complete for call ${callId} — score: ${result.score}, success: ${result.success}`);
  return { callId, locationId, ...result };
}

/**
 * Analyse pending call_logs for a location (no existing analysis).
 * Processes calls in batches of 3 concurrently to balance throughput and rate limits.
 *
 * @param {string} locationId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array>}
 */
async function analysePendingCalls(locationId, { limit = 20 } = {}) {
  const pending = await pool.query(
    `SELECT cl.call_id FROM call_logs cl
     LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
     WHERE cl.location_id = $1 AND ca.call_id IS NULL
     ORDER BY cl.started_at DESC
     LIMIT $2`,
    [locationId, limit]
  );

  log.info(`Analysing ${pending.rows.length} pending calls for location:`, locationId);

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
