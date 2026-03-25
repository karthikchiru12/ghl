'use strict';

const { Router } = require('express');
const { getDashboardSummary } = require('../services/dashboard');
const { ensureLocationHydrated } = require('../services/hydration');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:dashboard');
const router = Router({ mergeParams: true });

// GET /api/locations/:locationId/dashboard?limit=10
router.get('/', async (req, res) => {
  const { locationId } = req.params;
  const { agentId } = req.query;
  const recentLimit = Math.min(50, Math.max(5, Number(req.query.limit) || 10));
  const shouldHydrate = req.query.hydrate === 'true';

  try {
    let hydration = null;
    if (shouldHydrate) {
      hydration = await ensureLocationHydrated(locationId, {
        agentId: agentId || null,
        analyzeLimit: null,
      });
    }

    const summary = await getDashboardSummary(locationId, { recentLimit, agentId: agentId || null });
    return res.json({ ok: true, dashboard: summary, hydration });
  } catch (err) {
    log.error(`Dashboard summary failed for ${locationId}:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
