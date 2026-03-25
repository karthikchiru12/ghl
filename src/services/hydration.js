'use strict';

const { createLogger } = require('../lib/logger');
const { syncCallLogs } = require('./callLogs');
const { analysePendingCalls } = require('./analysis');
const { syncAgents } = require('./voiceAgents');

const log = createLogger('hydration');
const inflight = new Map();
const lastRun = new Map();

async function ensureLocationHydrated(
  locationId,
  {
    agentId = null,
    force = false,
    throttleMs = 5 * 60 * 1000,
    syncPageSize = 100,
    analyzeLimit = null,
  } = {}
) {
  const key = `${locationId}:${agentId || 'all'}`;
  const now = Date.now();
  const lastStartedAt = lastRun.get(key) || 0;

  if (!force && (now - lastStartedAt) < throttleMs) {
    return { ok: true, skipped: true, reason: 'throttled', locationId, agentId };
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const task = (async () => {
    lastRun.set(key, Date.now());
    log.info(`Hydrating location ${locationId}${agentId ? ` for agent ${agentId}` : ''}`);

    let agentsSynced = 0;
    try {
      const agents = await syncAgents(locationId, { page: 1, pageSize: 100 });
      agentsSynced = Array.isArray(agents) ? agents.length : 0;
    } catch (error) {
      log.warn(`Agent sync failed during hydration for ${locationId}:`, error.message);
    }

    const syncedCalls = await syncCallLogs(locationId, {
      agentId,
      page: 1,
      pageSize: syncPageSize,
      allPages: true,
    });

    const analysisResults = await analysePendingCalls(locationId, { agentId, limit: analyzeLimit });
    const analyzed = analysisResults.filter((item) => item.ok).length;
    const failed = analysisResults.length - analyzed;

    return {
      ok: true,
      skipped: false,
      locationId,
      agentId,
      agentsSynced,
      callsSynced: Array.isArray(syncedCalls) ? syncedCalls.length : 0,
      analysis: {
        total: analysisResults.length,
        succeeded: analyzed,
        failed,
      },
    };
  })();

  inflight.set(key, task);

  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

module.exports = { ensureLocationHydrated };
