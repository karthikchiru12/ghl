'use strict';

const { Router } = require('express');
const { pool } = require('../db/pool');
const { highLevel } = require('../lib/ghl');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:locations');
const router = Router();

// GET /api/locations — all installed locations from DB
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT location_id, company_id, name, created_at, updated_at
       FROM locations ORDER BY COALESCE(name, location_id)`
    );
    return res.json({ ok: true, locations: result.rows });
  } catch (err) {
    log.error('Failed to fetch locations:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to fetch locations' });
  }
});

// GET /api/locations/:locationId — enriched via SDK locations service
router.get('/:locationId', async (req, res) => {
  const { locationId } = req.params;
  try {
    const sdkData = await highLevel.locations.getLocation(
      { locationId },
      { preferredTokenType: 'location' }
    );
    const dbResult = await pool.query(
      `SELECT * FROM locations WHERE location_id = $1`,
      [locationId]
    );
    return res.json({
      ok:       true,
      location: sdkData?.location ?? sdkData,
      local:    dbResult.rows[0] ?? null,
    });
  } catch (err) {
    log.error(`Failed to fetch location ${locationId}:`, err.message);
    return res.status(err.statusCode ?? err.status ?? 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
