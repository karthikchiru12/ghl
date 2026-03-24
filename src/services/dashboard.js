'use strict';

const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('dashboard');

/**
 * Aggregate dashboard summary for a given locationId.
 * Returns KPI stats, per-agent breakdowns, top failures, and pending counts.
 *
 * @param {string} locationId
 * @returns {Promise<object>}
 */
async function getDashboardSummary(locationId) {
  log.debug('Building dashboard summary for location:', locationId);

  const [callStats, agentStats, topFailures, recentAnalyses] = await Promise.all([
    // ─── Overall call stats ────────────────────────────────────────────────
    pool.query(
      `SELECT
         COUNT(*)                          AS total_calls,
         COUNT(ca.call_id)                 AS analysed_calls,
         AVG(ca.score)::NUMERIC(5,1)       AS avg_score,
         SUM(CASE WHEN ca.success THEN 1 ELSE 0 END) AS successful_calls,
         AVG(cl.duration_seconds)::INT     AS avg_duration_seconds
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
         COUNT(cl.call_id)                          AS total_calls,
         COUNT(ca.call_id)                          AS analysed_calls,
         AVG(ca.score)::NUMERIC(5,1)                AS avg_score,
         SUM(CASE WHEN ca.success THEN 1 ELSE 0 END) AS successful_calls
       FROM voice_agents va
       LEFT JOIN call_logs cl ON cl.agent_id = va.agent_id
       LEFT JOIN call_analyses ca ON ca.call_id = cl.call_id
       WHERE va.location_id = $1
       GROUP BY va.agent_id, va.name
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

    // ─── 5 most recent analyses with key fields ────────────────────────────
    pool.query(
      `SELECT ca.call_id, ca.agent_id, ca.success, ca.score,
              ca.failures, ca.use_actions, ca.analyzed_at,
              cl.started_at, cl.duration_seconds
       FROM call_analyses ca
       JOIN call_logs cl ON cl.call_id = ca.call_id
       WHERE ca.location_id = $1
       ORDER BY ca.analyzed_at DESC
       LIMIT 5`,
      [locationId]
    ),
  ]);

  const stats  = callStats.rows[0];
  const total  = Number(stats.total_calls ?? 0);
  const analysed = Number(stats.analysed_calls ?? 0);
  const successful = Number(stats.successful_calls ?? 0);

  return {
    locationId,
    overview: {
      totalCalls:        total,
      analysedCalls:     analysed,
      pendingCalls:      total - analysed,
      successRate:       analysed > 0 ? Math.round((successful / analysed) * 100) : null,
      avgScore:          stats.avg_score ? parseFloat(stats.avg_score) : null,
      avgDurationSeconds: stats.avg_duration_seconds,
    },
    agentBreakdown: agentStats.rows.map((r) => ({
      agentId:       r.agent_id,
      agentName:     r.agent_name ?? r.agent_id,
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
  };
}

module.exports = { getDashboardSummary };
