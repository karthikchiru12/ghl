'use strict';

const { Router } = require('express');
const { syncAgents, getAgentsByLocation } = require('../services/voiceAgents');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:agents');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/agents?sync=true
router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const doSync = req.query.sync === 'true';

  try {
    const agents = doSync
      ? await syncAgents(locationId)
      : await getAgentsByLocation(locationId);

    return res.json({ ok: true, locationId, agents });
  } catch (err) {
    log.error(`Failed to fetch agents for ${locationId}:`, err.message);
    const status = err.status ?? 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

module.exports = router;
