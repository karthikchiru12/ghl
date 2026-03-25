'use strict';

const { Router } = require('express');
const { syncAgents, getAgentsByLocation, getAgentDetail } = require('../services/voiceAgents');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:agents');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/agents?sync=true
router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const doSync = req.query.sync === 'true';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

  try {
    const agents = doSync
      ? await syncAgents(locationId, { page, pageSize })
      : await getAgentsByLocation(locationId);

    return res.json({ ok: true, locationId, agents });
  } catch (err) {
    log.error(`Failed to fetch agents for ${locationId}:`, err.message);
    const status = err.status ?? 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

router.get('/:agentId', async (req, res) => {
  const { locationId, agentId } = req.params;
  const refresh = req.query.refresh === 'true';

  try {
    const agent = await getAgentDetail(agentId, locationId, { refresh });
    if (!agent) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }
    return res.json({ ok: true, locationId, agent });
  } catch (err) {
    log.error(`Failed to fetch agent ${agentId} for ${locationId}:`, err.message);
    return res.status(err.status ?? 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
