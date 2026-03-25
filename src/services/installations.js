'use strict';

const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');
const { logEvent } = require('./activityLog');

const log = createLogger('installations');

function getAppId() {
  const clientId = process.env.HIGHLEVEL_CLIENT_ID || process.env.CLIENT_ID || '';
  return clientId ? clientId.split('-')[0] : 'unknown-app';
}

async function upsertInstallation(payload, { installed = true } = {}) {
  const appId = payload.appId || getAppId();
  const locationId = payload.locationId || payload.location_id;

  if (!locationId) {
    throw new Error('locationId is required to persist an installation');
  }

  const companyId = payload.companyId ?? payload.company_id ?? null;
  const locationName = payload.locationName ?? payload.name ?? payload.location_name ?? null;
  const tokenResourceId = payload.tokenResourceId ?? payload.resourceId ?? locationId;
  const tokenPayload = payload.tokenPayload ?? payload.token_payload ?? {};
  const installContext = payload.installContext ?? payload.install_context ?? {};
  const rawPayload = payload.rawPayload ?? payload.raw_payload ?? payload;
  const userType = payload.userType ?? payload.user_type ?? null;
  const authMode = payload.authMode ?? (process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN ? 'pit' : 'oauth');

  await pool.query(
    `INSERT INTO ghl_installations
       (app_id, location_id, company_id, location_name, user_type, auth_mode,
        token_resource_id, token_payload, install_context, raw_payload, installed_at, updated_at, uninstalled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, NOW(), NOW(), NULL)
     ON CONFLICT (location_id) DO UPDATE
       SET app_id            = EXCLUDED.app_id,
           company_id        = EXCLUDED.company_id,
           location_name     = COALESCE(EXCLUDED.location_name, ghl_installations.location_name),
           user_type         = COALESCE(EXCLUDED.user_type, ghl_installations.user_type),
           auth_mode         = EXCLUDED.auth_mode,
           token_resource_id = COALESCE(EXCLUDED.token_resource_id, ghl_installations.token_resource_id),
           token_payload     = CASE
                                 WHEN EXCLUDED.token_payload = '{}'::jsonb
                                 THEN ghl_installations.token_payload
                                 ELSE EXCLUDED.token_payload
                               END,
           install_context   = COALESCE(EXCLUDED.install_context, ghl_installations.install_context),
           raw_payload       = COALESCE(EXCLUDED.raw_payload, ghl_installations.raw_payload),
           updated_at        = NOW(),
           uninstalled_at    = CASE WHEN $11 THEN NULL ELSE NOW() END`,
    [
      appId,
      locationId,
      companyId,
      locationName,
      userType,
      authMode,
      tokenResourceId,
      JSON.stringify(tokenPayload),
      JSON.stringify(installContext),
      JSON.stringify(rawPayload),
      installed,
    ]
  );

  await pool.query(
    `INSERT INTO locations
       (location_id, app_id, company_id, name, token_resource_id, install_context, installed_at, uninstalled_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NULL, NOW(), NOW())
     ON CONFLICT (location_id) DO UPDATE
       SET app_id            = EXCLUDED.app_id,
           company_id        = EXCLUDED.company_id,
           name              = COALESCE(EXCLUDED.name, locations.name),
           token_resource_id = COALESCE(EXCLUDED.token_resource_id, locations.token_resource_id),
           install_context   = COALESCE(EXCLUDED.install_context, locations.install_context),
           installed_at      = CASE WHEN $7 THEN COALESCE(locations.installed_at, NOW()) ELSE locations.installed_at END,
           uninstalled_at    = CASE WHEN $7 THEN NULL ELSE NOW() END,
           updated_at        = NOW()`,
    [
      locationId,
      appId,
      companyId,
      locationName,
      tokenResourceId,
      JSON.stringify(installContext),
      installed,
    ]
  );

  await logEvent({
    locationId,
    companyId,
    eventType: installed ? 'installation.updated' : 'installation.uninstalled',
    status: installed ? 'success' : 'warn',
    title: installed ? 'HighLevel install synced' : 'HighLevel uninstall received',
    detail: locationName || locationId,
    payload: { appId, locationId, companyId, tokenResourceId, userType, authMode },
  });
}

async function getInstalledLocations({ companyId, includeUninstalled = false } = {}) {
  const values = [];
  const predicates = [];

  if (companyId) {
    values.push(companyId);
    predicates.push(`company_id = $${values.length}`);
  }

  if (!includeUninstalled) {
    predicates.push('uninstalled_at IS NULL');
  }

  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT
       location_id,
       app_id,
       company_id,
       COALESCE(location_name, name) AS name,
       token_resource_id,
       install_context,
       installed_at,
       updated_at,
       uninstalled_at
     FROM (
       SELECT
         gi.location_id,
         gi.app_id,
         gi.company_id,
         gi.location_name,
         l.name,
         COALESCE(gi.token_resource_id, l.token_resource_id) AS token_resource_id,
         COALESCE(gi.install_context, l.install_context, '{}'::jsonb) AS install_context,
         COALESCE(gi.installed_at, l.installed_at) AS installed_at,
         GREATEST(COALESCE(gi.updated_at, l.updated_at), COALESCE(l.updated_at, gi.updated_at)) AS updated_at,
         COALESCE(gi.uninstalled_at, l.uninstalled_at) AS uninstalled_at
       FROM ghl_installations gi
       FULL OUTER JOIN locations l ON l.location_id = gi.location_id
     ) locations_view
     ${where}
     ORDER BY COALESCE(name, location_id)`,
    values
  );

  return result.rows;
}

async function getLocationRecord(locationId) {
  const result = await pool.query(
    `SELECT
       l.location_id,
       l.app_id,
       l.company_id,
       COALESCE(gi.location_name, l.name) AS name,
       COALESCE(gi.token_resource_id, l.token_resource_id) AS token_resource_id,
       COALESCE(gi.install_context, l.install_context, '{}'::jsonb) AS install_context,
       COALESCE(gi.installed_at, l.installed_at) AS installed_at,
       GREATEST(COALESCE(gi.updated_at, l.updated_at), COALESCE(l.updated_at, gi.updated_at)) AS updated_at,
       COALESCE(gi.uninstalled_at, l.uninstalled_at) AS uninstalled_at
     FROM locations l
     LEFT JOIN ghl_installations gi ON gi.location_id = l.location_id
     WHERE l.location_id = $1
     LIMIT 1`,
    [locationId]
  );

  return result.rows[0] ?? null;
}

async function markUninstalled(payload) {
  try {
    await upsertInstallation(payload, { installed: false });
  } catch (error) {
    log.error('Failed to mark installation as uninstalled:', error.message);
  }
}

module.exports = {
  getAppId,
  upsertInstallation,
  getInstalledLocations,
  getLocationRecord,
  markUninstalled,
};
