'use strict';

const { pool } = require('../db/pool');

async function logEvent({
  locationId = null,
  companyId = null,
  eventType,
  status = 'info',
  title,
  detail = null,
  payload = {},
}) {
  if (!eventType || !title) return;

  await pool.query(
    `INSERT INTO app_events
       (location_id, company_id, event_type, status, title, detail, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    [
      locationId,
      companyId,
      eventType,
      status,
      title,
      detail,
      JSON.stringify(payload ?? {}),
    ]
  );
}

async function getEventsByLocation(locationId, { limit = 50 } = {}) {
  const result = await pool.query(
    `SELECT id, location_id, company_id, event_type, status, title, detail, payload, created_at
     FROM app_events
     WHERE location_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [locationId, limit]
  );

  return result.rows;
}

module.exports = { logEvent, getEventsByLocation };
