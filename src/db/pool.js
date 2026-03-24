'use strict';

const { Pool } = require('pg');
const { createLogger } = require('../lib/logger');

const log = createLogger('db:pool');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sslValue = process.env.DATABASE_SSL;
let ssl = false;
if (sslValue === 'true' || sslValue === 'require') {
  ssl = { rejectUnauthorized: false };
} else if (sslValue === 'verify') {
  ssl = true;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ssl || undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  log.error('Unexpected idle client error:', err.message);
});

module.exports = { pool };
