'use strict';

const { Router } = require('express');
const { getDashboardSummary } = require('../services/dashboard');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:dashboard');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/dashboard?limit=10
router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const recentLimit = Math.min(50, Math.max(5, Number(req.query.limit) || 10));

  try {
    const summary = await getDashboardSummary(locationId, { recentLimit });
    return res.json({ ok: true, dashboard: summary });
  } catch (err) {
    log.error(`Dashboard summary failed for ${locationId}:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
