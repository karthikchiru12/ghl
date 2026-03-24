'use strict';

const { Router } = require('express');
const { highLevel } = require('../lib/ghl');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:webhooks');
const router = Router();

// ─── GHL SDK signature verification + token persistence middleware ────────────
// The SDK's subscribe() intercepts INSTALL/UNINSTALL events and persists the
// OAuth tokens into the sessionStorage we injected (PostgresSessionStorage).
router.use(highLevel.webhooks.subscribe());

// ─── POST /webhooks/ghl ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const isValid   = Boolean(req.isSignatureValid);
  const eventType = req.body?.type ?? req.body?.event ?? null;
  const payload   = req.body ?? {};

  if (process.env.LOG_WEBHOOK_BODIES === 'true') {
    log.debug('Webhook body:', JSON.stringify(payload));
  } else {
    log.info('Webhook event:', eventType, isValid ? '(valid sig)' : '(no sig check)');
  }

  // ─── INSTALL — SDK has already stored the token in Postgres via sessionStorage.
  // We just persist the location row. No extra SDK calls needed here.
  if (eventType === 'INSTALL') {
    const locationId = payload.locationId ?? payload.location_id ?? null;
    const companyId  = payload.companyId  ?? payload.company_id  ?? null;
    // GHL sends the name directly in the webhook payload
    const name       = payload.locationName ?? payload.name ?? null;

    if (locationId) {
      try {
        await pool.query(
          `INSERT INTO locations (location_id, company_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (location_id) DO UPDATE
             SET company_id = EXCLUDED.company_id,
                 name       = COALESCE(EXCLUDED.name, locations.name),
                 updated_at = NOW()`,
          [locationId, companyId, name]
        );
        log.info('Location installed and persisted:', locationId, name ? `(${name})` : '');
      } catch (err) {
        log.error('Failed to persist installed location:', err.message);
      }
    }
  }

  // ─── UNINSTALL — keep data, just log it
  if (eventType === 'UNINSTALL') {
    const locationId = payload.locationId ?? payload.location_id ?? null;
    if (locationId) {
      log.info('App uninstalled from location:', locationId);
    }
  }

  return res.json({ ok: true, isValid, eventType });
});

module.exports = router;
