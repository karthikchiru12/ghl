'use strict';

/**
 * Creates all application tables on startup.
 * All statements are idempotent (CREATE TABLE IF NOT EXISTS).
 */
const { pool } = require('./pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('db:init');

async function dangerouslyResetDbOnStartup() {
  log.warn('DANGER: wiping application tables on startup');

  await pool.query(`
    DROP TABLE IF EXISTS
      app_events,
      call_analyses,
      call_logs,
      voice_agents,
      ghl_installations,
      locations,
      ghl_sessions
    CASCADE
  `);
}

async function initDb() {
  log.info('Initializing database schema...');

  // TEMPORARY FOR ASSIGNMENT DEMOS:
  // Comment out the next line before productionizing, otherwise every restart
  // or redeploy will wipe all installs, tokens, cached agents, calls, analyses,
  // and logs from Postgres.
  await dangerouslyResetDbOnStartup();

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
      app_id       TEXT,
      company_id   TEXT,
      name         TEXT,
      token_resource_id TEXT,
      install_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uninstalled_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ghl_installations (
      app_id            TEXT NOT NULL,
      location_id       TEXT PRIMARY KEY,
      company_id        TEXT,
      location_name     TEXT,
      user_type         TEXT,
      auth_mode         TEXT NOT NULL DEFAULT 'oauth',
      token_resource_id TEXT,
      token_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
      install_context   JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      installed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uninstalled_at    TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ghl_installations_app_company_idx
    ON ghl_installations (app_id, company_id, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_agents (
      agent_id     TEXT PRIMARY KEY,
      location_id  TEXT NOT NULL,
      name         TEXT,
      status       TEXT,
      goals        JSONB,
      script       TEXT,
      business_name TEXT,
      welcome_message TEXT,
      prompt       TEXT,
      voice_id     TEXT,
      language     TEXT,
      patience_level TEXT,
      max_call_duration INT,
      timezone     TEXT,
      call_end_workflow_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      working_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions      JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      contact_id       TEXT,
      from_number      TEXT,
      transcript       JSONB,
      transcript_text  TEXT,
      summary          TEXT,
      extracted_data   JSONB,
      executed_actions JSONB,
      duration_seconds INT,
      status           TEXT,
      trial_call       BOOLEAN,
      translation      JSONB,
      message_id       TEXT,
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
      summary_text             TEXT,
      failures                 JSONB DEFAULT '[]',
      missed_opportunities     JSONB DEFAULT '[]',
      use_actions              JSONB DEFAULT '[]',
      transcript_highlights    JSONB DEFAULT '[]',
      prompt_recommendations   JSONB DEFAULT '[]',
      script_recommendations   JSONB DEFAULT '[]',
      action_recommendations   JSONB DEFAULT '[]',
      agent_snapshot           JSONB DEFAULT '{}'::jsonb,
      raw_response             TEXT,
      analyzed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS call_analyses_location_id_idx
    ON call_analyses (location_id, analyzed_at DESC)
  `);

  // Extended metrics column (safe for existing installs)
  await pool.query(`
    ALTER TABLE call_analyses
    ADD COLUMN IF NOT EXISTS metrics JSONB DEFAULT '{}'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_events (
      id            BIGSERIAL PRIMARY KEY,
      location_id   TEXT,
      company_id    TEXT,
      event_type    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'info',
      title         TEXT NOT NULL,
      detail        TEXT,
      payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_events_location_id_idx
    ON app_events (location_id, created_at DESC)
  `);

  await pool.query(`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS app_id TEXT
  `);

  await pool.query(`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS token_resource_id TEXT
  `);

  await pool.query(`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS install_context JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS business_name TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS welcome_message TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS prompt TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS voice_id TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS language TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS patience_level TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS max_call_duration INT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS timezone TEXT
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS call_end_workflow_ids JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS working_hours JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE voice_agents
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS contact_id TEXT
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS from_number TEXT
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS transcript_text TEXT
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS trial_call BOOLEAN
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS translation JSONB
  `);

  await pool.query(`
    ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS message_id TEXT
  `);

  await pool.query(`
    ALTER TABLE call_analyses
    ADD COLUMN IF NOT EXISTS summary_text TEXT
  `);

  await pool.query(`
    ALTER TABLE call_analyses
    ADD COLUMN IF NOT EXISTS transcript_highlights JSONB DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE call_analyses
    ADD COLUMN IF NOT EXISTS action_recommendations JSONB DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    ALTER TABLE call_analyses
    ADD COLUMN IF NOT EXISTS agent_snapshot JSONB DEFAULT '{}'::jsonb
  `);

  log.info('Database schema ready.');
}

module.exports = { initDb };
