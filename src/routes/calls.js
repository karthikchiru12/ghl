'use strict';

const { Router } = require('express');
const { syncCallLogs, getCallsByLocation, getCallDetail } = require('../services/callLogs');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:calls');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/calls?sync=true&agentId=&limit=&page=
router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const { agentId, sync, limit = '50', page = '1' } = req.query;
  const doSync = sync === 'true';
  const opts   = { agentId, limit: Number(limit), page: Number(page) };

  try {
    const calls = doSync
      ? await syncCallLogs(locationId, opts)
      : await getCallsByLocation(locationId, opts);

    return res.json({ ok: true, locationId, calls });
  } catch (err) {
    log.error(`Failed to fetch calls for ${locationId}:`, err.message);
    return res.status(err.status ?? 500).json({ ok: false, error: err.message });
  }
});

// GET /api/locations/:locationId/calls/:callId
router.get('/:callId', async (req, res) => {
  const { locationId, callId } = req.params;

  try {
    const call = await getCallDetail(callId, locationId);
    if (!call) return res.status(404).json({ ok: false, error: 'Call not found' });
    return res.json({ ok: true, call });
  } catch (err) {
    log.error(`Failed to fetch call ${req.params.callId}:`, err.message);
    return res.status(err.status ?? 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
