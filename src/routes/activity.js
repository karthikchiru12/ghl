'use strict';

const { Router } = require('express');
const { getEventsByLocation } = require('../services/activityLog');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:activity');
const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 40));

  try {
    const events = await getEventsByLocation(locationId, { limit });
    return res.json({ ok: true, events });
  } catch (error) {
    log.error(`Failed to fetch activity for ${locationId}:`, error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
