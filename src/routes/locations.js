'use strict';

const { Router } = require('express');
const { highLevel } = require('../lib/ghl');
const { createLogger } = require('../lib/logger');
const { getInstalledLocations, getLocationRecord } = require('../services/installations');
const { sdkOptions } = require('../services/voiceAgents');

const log    = createLogger('routes:locations');
const router = Router();

// GET /api/locations — all installed locations from DB
router.get('/', async (req, res) => {
  try {
    const locations = await getInstalledLocations({
      companyId: req.ghlContext?.user?.companyId || null,
    });
    return res.json({ ok: true, locations });
  } catch (err) {
    log.error('Failed to fetch locations:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to fetch locations' });
  }
});

// GET /api/locations/:locationId — enriched via SDK locations service
router.get('/:locationId', async (req, res) => {
  const { locationId } = req.params;
  try {
    const opts = await sdkOptions(locationId);
    const sdkData = await highLevel.locations.getLocation(
      { locationId },
      opts
    );
    const dbRecord = await getLocationRecord(locationId);
    return res.json({
      ok:       true,
      location: sdkData?.location ?? sdkData,
      local:    dbRecord,
    });
  } catch (err) {
    log.error(`Failed to fetch location ${locationId}:`, err.message);
    return res.status(err.statusCode ?? err.status ?? 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
