'use strict';

const { SessionStorage, Logger } = require('@gohighlevel/api-client');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('SessionStorage');

/**
 * PostgreSQL-backed session storage for the GHL SDK.
 * Stores OAuth tokens per (appId, resourceId) pair.
 */
class PostgresSessionStorage extends SessionStorage {
  constructor() {
    // SDK's Logger is satisfied with a warn-level default
    super(new Logger('warn', 'GHL SDK Postgres'));
    this.pool = pool;
    this.clientId = '';
    this.initialized = false;
  }

  setClientId(clientId) {
    if (!clientId) throw new Error('ClientId is required for session storage');
    this.clientId = clientId;
    log.debug('clientId set:', clientId);
  }

  getApplicationId() {
    if (!this.clientId) {
      throw new Error('ClientId not set. Configure HighLevel with a valid clientId first.');
    }
    // GHL uses the portion before the first hyphen as the appId
    return this.clientId.split('-')[0];
  }

  async init() {
    if (this.initialized) return;
    // Table is created by db/init.js; this is a no-op guard
    this.initialized = true;
    log.info('PostgresSessionStorage ready');
  }

  async disconnect() {
    this.initialized = false;
  }

  // Required by SDK but unused here (table is created in db/init.js)
  async createCollection() {}
  async getCollection(name) { return name; }

  async setSession(resourceId, sessionData) {
    const appId = this.getApplicationId();
    const expireAt = this.calculateExpireAt(sessionData.expires_in);
    const payload = { ...sessionData, expire_at: expireAt };

    await this.pool.query(
      `INSERT INTO ghl_sessions (app_id, resource_id, session_data, expire_at, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
       ON CONFLICT (app_id, resource_id) DO UPDATE
         SET session_data = EXCLUDED.session_data,
             expire_at    = EXCLUDED.expire_at,
             updated_at   = NOW()`,
      [appId, resourceId, JSON.stringify(payload), expireAt ?? null]
    );

    log.debug('Session saved for resourceId:', resourceId);
  }

  async getSession(resourceId) {
    const appId = this.getApplicationId();
    const result = await this.pool.query(
      `SELECT session_data FROM ghl_sessions
       WHERE app_id = $1 AND resource_id = $2 LIMIT 1`,
      [appId, resourceId]
    );
    return result.rows[0]?.session_data ?? null;
  }

  async deleteSession(resourceId) {
    const appId = this.getApplicationId();
    await this.pool.query(
      `DELETE FROM ghl_sessions WHERE app_id = $1 AND resource_id = $2`,
      [appId, resourceId]
    );
    log.debug('Session deleted for resourceId:', resourceId);
  }

  async getAccessToken(resourceId) {
    const session = await this.getSession(resourceId);
    return session?.access_token ?? null;
  }

  async getRefreshToken(resourceId) {
    const session = await this.getSession(resourceId);
    return session?.refresh_token ?? null;
  }

  async getSessionsByApplication() {
    const appId = this.getApplicationId();
    const result = await this.pool.query(
      `SELECT session_data FROM ghl_sessions
       WHERE app_id = $1 ORDER BY updated_at DESC`,
      [appId]
    );
    return result.rows.map((r) => r.session_data);
  }
}

// Singleton — one instance for the whole app
const sessionStorage = new PostgresSessionStorage();

module.exports = { sessionStorage, PostgresSessionStorage };
