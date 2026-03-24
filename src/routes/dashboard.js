'use strict';

const { Router } = require('express');
const { getDashboardSummary } = require('../services/dashboard');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:dashboard');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/dashboard
router.get('/', async (req, res) => {
  const { locationId } = req.params;

  try {
    const summary = await getDashboardSummary(locationId);
    return res.json({ ok: true, dashboard: summary });
  } catch (err) {
    log.error(`Dashboard summary failed for ${locationId}:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
