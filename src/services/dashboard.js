'use strict';

const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('dashboard');

/**
 * Aggregate dashboard summary for a given locationId.
 *
 * @param {string} locationId
 * @param {{ recentLimit?: number }} [opts]
 * @returns {Promise<object>}
 */
async function getDashboardSummary(locationId, { recentLimit = 10 } = {}) {
  log.debug('Building dashboard summary for location:', locationId);

  const [callStats, agentStats, topFailures, recentAnalyses, recentCalls, scoreTrend, actionTypes] = await Promise.all([
    // ─── Overall call stats ────────────────────────────────────────────────
    pool.query(
      `SELECT
         COUNT(*)                                    AS total_calls,
         COUNT(ca.call_id)                           AS analysed_calls,
         AVG(ca.score)::NUMERIC(5,1)                 AS avg_score,
         SUM(CASE WHEN ca.success THEN 1 ELSE 0 END) AS successful_calls,
         AVG(cl.duration_seconds)::INT               AS avg_duration_seconds,
         MAX(cl.started_at)                          AS last_call_at
       FROM call_logs cl
       LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
       WHERE cl.location_id = $1`,
      [locationId]
    ),

    // ─── Per-agent breakdown ───────────────────────────────────────────────
    pool.query(
      `SELECT
         va.agent_id,
         va.name                                    AS agent_name,
         va.status,
         va.prompt,
         jsonb_array_length(COALESCE(va.actions, '[]'::jsonb)) AS action_count,
         COUNT(cl.call_id)                          AS total_calls,
         COUNT(ca.call_id)                          AS analysed_calls,
         AVG(ca.score)::NUMERIC(5,1)                AS avg_score,
         SUM(CASE WHEN ca.success THEN 1 ELSE 0 END) AS successful_calls
       FROM voice_agents va
       LEFT JOIN call_logs cl ON cl.agent_id = va.agent_id
       LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
       WHERE va.location_id = $1
       GROUP BY va.agent_id
       ORDER BY total_calls DESC`,
      [locationId]
    ),

    // ─── Top recurring failures across all analyses ────────────────────────
    pool.query(
      `SELECT failure_text, COUNT(*) AS frequency
       FROM (
         SELECT jsonb_array_elements_text(failures) AS failure_text
         FROM call_analyses WHERE location_id = $1
       ) sub
       GROUP BY failure_text
       ORDER BY frequency DESC
       LIMIT 10`,
      [locationId]
    ),

    // ─── N most recent analyses with agent name ────────────────────────────
    pool.query(
      `SELECT
         ca.call_id, ca.agent_id, ca.success, ca.score,
         ca.failures, ca.use_actions, ca.analyzed_at,
         cl.started_at, cl.duration_seconds,
         va.name AS agent_name
       FROM call_analyses ca
       JOIN call_logs cl ON cl.call_id = ca.call_id
       LEFT JOIN voice_agents va ON va.agent_id = ca.agent_id
       WHERE ca.location_id = $1
       ORDER BY ca.analyzed_at DESC
       LIMIT $2`,
      [locationId, recentLimit]
    ),

    pool.query(
      `SELECT
         cl.call_id,
         cl.agent_id,
         cl.summary,
         cl.duration_seconds,
         cl.started_at,
         cl.from_number,
         va.name AS agent_name,
         ca.score,
         ca.success
       FROM call_logs cl
       LEFT JOIN voice_agents va ON va.agent_id = cl.agent_id
       LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
       WHERE cl.location_id = $1
       ORDER BY cl.started_at DESC NULLS LAST
       LIMIT $2`,
      [locationId, recentLimit]
    ),

    // ─── 7-day daily avg score trend ──────────────────────────────────────
    pool.query(
      `SELECT
         DATE_TRUNC('day', analyzed_at)::DATE AS day,
         AVG(score)::NUMERIC(4,1)             AS avg_score,
         COUNT(*)                             AS call_count
       FROM call_analyses
       WHERE location_id = $1
         AND analyzed_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE_TRUNC('day', analyzed_at)::DATE
       ORDER BY day ASC`,
      [locationId]
    ),

    pool.query(
      `SELECT
         action_type,
         COUNT(*) AS frequency
       FROM (
         SELECT
           jsonb_array_elements(COALESCE(executed_actions, '[]'::jsonb))->>'actionType' AS action_type
         FROM call_logs
         WHERE location_id = $1
       ) actions
       WHERE action_type IS NOT NULL
       GROUP BY action_type
       ORDER BY frequency DESC
       LIMIT 8`,
      [locationId]
    ),
  ]);

  const stats      = callStats.rows[0];
  const total      = Number(stats.total_calls ?? 0);
  const analysed   = Number(stats.analysed_calls ?? 0);
  const successful = Number(stats.successful_calls ?? 0);

  return {
    locationId,
    overview: {
      totalCalls:         total,
      analysedCalls:      analysed,
      pendingCalls:       total - analysed,
      successRate:        analysed > 0 ? Math.round((successful / analysed) * 100) : null,
      avgScore:           stats.avg_score ? parseFloat(stats.avg_score) : null,
      avgDurationSeconds: stats.avg_duration_seconds,
      lastCallAt:         stats.last_call_at ?? null,
    },
    agentBreakdown: agentStats.rows.map((r) => ({
      agentId:       r.agent_id,
      agentName:     r.agent_name ?? r.agent_id,
      status:        r.status ?? 'unknown',
      promptPreview: r.prompt ? String(r.prompt).slice(0, 180) : null,
      actionCount:   Number(r.action_count ?? 0),
      totalCalls:    Number(r.total_calls),
      analysedCalls: Number(r.analysed_calls),
      avgScore:      r.avg_score ? parseFloat(r.avg_score) : null,
      successRate:
        Number(r.analysed_calls) > 0
          ? Math.round((Number(r.successful_calls) / Number(r.analysed_calls)) * 100)
          : null,
    })),
    topFailures: topFailures.rows.map((r) => ({
      text:      r.failure_text,
      frequency: Number(r.frequency),
    })),
    recentAnalyses: recentAnalyses.rows,
    recentCalls: recentCalls.rows,
    scoreTrend: scoreTrend.rows.map((r) => ({
      day:      r.day,
      avgScore: parseFloat(r.avg_score),
      count:    Number(r.call_count),
    })),
    actionBreakdown: actionTypes.rows.map((row) => ({
      actionType: row.action_type,
      frequency: Number(row.frequency),
    })),
  };
}

module.exports = { getDashboardSummary };
