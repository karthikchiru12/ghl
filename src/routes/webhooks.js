'use strict';

const { Router } = require('express');
const { highLevel } = require('../lib/ghl');
const { createLogger } = require('../lib/logger');
const { getAppId, markUninstalled, upsertInstallation } = require('../services/installations');

const log    = createLogger('routes:webhooks');
const router = Router();
const sdkWebhookMiddleware = highLevel.webhooks.subscribe();

// ─── GHL SDK signature verification + token persistence middleware ────────────
// The SDK's subscribe() intercepts INSTALL/UNINSTALL events and persists the
// OAuth tokens into the sessionStorage we injected (PostgresSessionStorage).
router.use((req, res, next) => {
  sdkWebhookMiddleware(req, res, (err) => {
    if (
      err &&
      req.body?.type === 'INSTALL' &&
      /token is not authorized for this scope/i.test(err.message || '')
    ) {
      log.warn(
        'Ignoring SDK location-token generation failure for INSTALL webhook; OAuth callback already stores the location token.'
      );
      return next();
    }

    return next(err);
  });
});

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
    const name       = payload.locationName ?? payload.name ?? null;

    if (locationId) {
      try {
        await upsertInstallation({
          appId: getAppId(),
          locationId,
          companyId,
          locationName: name,
          tokenResourceId: locationId,
          installContext: {
            source: 'webhook',
            userId: payload.userId ?? null,
          },
          rawPayload: payload,
        });
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
      await markUninstalled({
        appId: getAppId(),
        locationId,
        companyId: payload.companyId ?? payload.company_id ?? null,
        locationName: payload.locationName ?? payload.name ?? null,
        rawPayload: payload,
      });
      log.info('App uninstalled from location:', locationId);
    }
  }

  return res.json({ ok: true, isValid, eventType });
});

module.exports = router;
