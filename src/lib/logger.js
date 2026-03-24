'use strict';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

function emit(level, prefix, args) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const ts = new Date().toISOString();
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${ts}] [${level.toUpperCase()}] [${prefix}]`, ...args);
}

function createLogger(prefix) {
  return {
    debug: (...a) => emit('debug', prefix, a),
    info:  (...a) => emit('info',  prefix, a),
    warn:  (...a) => emit('warn',  prefix, a),
    error: (...a) => emit('error', prefix, a),
    child: (subPrefix) => createLogger(`${prefix}:${subPrefix}`),
  };
}

module.exports = { createLogger };
