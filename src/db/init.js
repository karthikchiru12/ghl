'use strict';

/**
 * Creates all application tables on startup.
 * All statements are idempotent (CREATE TABLE IF NOT EXISTS).
 */
const { pool } = require('./pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('db:init');

async function initDb() {
  log.info('Initializing database schema...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ghl_sessions (
      app_id       TEXT NOT NULL,
      resource_id  TEXT NOT NULL,
      session_data JSONB NOT NULL,
      expire_at    BIGINT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (app_id, resource_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ghl_sessions_app_id_idx
    ON ghl_sessions (app_id, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      location_id  TEXT PRIMARY KEY,
      company_id   TEXT,
      name         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_agents (
      agent_id     TEXT PRIMARY KEY,
      location_id  TEXT NOT NULL,
      name         TEXT,
      status       TEXT,
      goals        JSONB,
      script       TEXT,
      raw          JSONB,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS voice_agents_location_id_idx
    ON voice_agents (location_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_logs (
      call_id          TEXT PRIMARY KEY,
      agent_id         TEXT,
      location_id      TEXT NOT NULL,
      transcript       JSONB,
      summary          TEXT,
      extracted_data   JSONB,
      executed_actions JSONB,
      duration_seconds INT,
      status           TEXT,
      started_at       TIMESTAMPTZ,
      ended_at         TIMESTAMPTZ,
      raw              JSONB,
      synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS call_logs_location_id_idx
    ON call_logs (location_id, started_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS call_logs_agent_id_idx
    ON call_logs (agent_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS call_analyses (
      call_id                  TEXT PRIMARY KEY REFERENCES call_logs(call_id) ON DELETE CASCADE,
      location_id              TEXT NOT NULL,
      agent_id                 TEXT,
      success                  BOOLEAN,
      score                    INT,
      failures                 JSONB DEFAULT '[]',
      missed_opportunities     JSONB DEFAULT '[]',
      use_actions              JSONB DEFAULT '[]',
      prompt_recommendations   JSONB DEFAULT '[]',
      script_recommendations   JSONB DEFAULT '[]',
      raw_response             TEXT,
      analyzed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS call_analyses_location_id_idx
    ON call_analyses (location_id, analyzed_at DESC)
  `);

  log.info('Database schema ready.');
}

module.exports = { initDb };
