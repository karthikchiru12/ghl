'use strict';

const { Router } = require('express');
const { buildEmbeddedContext } = require('../services/context');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:context');
const router = Router();

router.post('/bootstrap', async (req, res) => {
  try {
    const context = await buildEmbeddedContext({
      encryptedData: req.body?.encryptedData || null,
      locationId: req.body?.locationId || req.query.locationId || null,
    });

    return res.json({ ok: true, context });
  } catch (error) {
    log.error('Failed to build embedded context:', error.message);
    return res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
