'use strict';

/**
 * Background sync scheduler.
 *
 * Runs a sync + analyze cycle on every active installed location at a
 * configurable interval (default 15 minutes).  This gives the copilot
 * near-real-time data without requiring the user to click "Sync & Analyze".
 *
 * Controlled via environment variables:
 *   SCHEDULER_ENABLED          — set to "false" to disable (default: true)
 *   SCHEDULER_INTERVAL_MINUTES — cycle frequency in minutes (default: 15)
 *   SCHEDULER_ANALYZE_LIMIT    — max calls to analyze per location per cycle (default: 10)
 */

const { syncCallLogs }         = require('./callLogs');
const { analysePendingCalls }  = require('./analysis');
const { getInstalledLocations } = require('./installations');
const { logEvent }             = require('./activityLog');
const { createLogger }         = require('../lib/logger');

const log = createLogger('scheduler');

const DEFAULT_INTERVAL_MS     = 15 * 60 * 1000;  // 15 min
const DEFAULT_ANALYZE_LIMIT   = 10;
const STARTUP_DELAY_MS        = 30 * 1000;        // wait 30 s after boot before first run

let _timer     = null;
let _running   = false;
let _lastRunAt = null;
let _lastStats = null;

// ─── Core cycle ──────────────────────────────────────────────────────────────

/**
 * Run one full sync+analyze pass across every active installed location.
 * Locations are processed sequentially to avoid hammering the GHL API.
 */
async function runCycle() {
  if (_running) {
    log.info('Scheduler: cycle already in progress — skipping this tick');
    return;
  }

  _running = true;
  const startedAt = Date.now();
  log.info('Scheduler: starting sync cycle');

  const analyzeLimit = Number(process.env.SCHEDULER_ANALYZE_LIMIT) || DEFAULT_ANALYZE_LIMIT;

  let locations = [];
  try {
    locations = await getInstalledLocations();
  } catch (err) {
    log.error('Scheduler: failed to fetch installed locations —', err.message);
    _running = false;
    return;
  }

  if (!locations.length) {
    log.info('Scheduler: no active locations to sync');
    _running = false;
    return;
  }

  log.info(`Scheduler: processing ${locations.length} location(s)`);

  const summary = { total: locations.length, synced: 0, analyzed: 0, errors: 0 };

  for (const location of locations) {
    const { location_id } = location;

    try {
      // 1 — Pull the most recent page of calls (non-destructive upsert)
      await syncCallLogs(location_id, { pageSize: 50, allPages: false });

      // 2 — Analyze up to N pending calls for this location
      const results = await analysePendingCalls(location_id, { limit: analyzeLimit });
      const newlyAnalyzed = results.filter((r) => r.ok).length;

      summary.synced   += 1;
      summary.analyzed += newlyAnalyzed;

      if (newlyAnalyzed > 0) {
        log.info(`Scheduler: location ${location_id} — ${newlyAnalyzed} new call(s) analyzed`);
      }
    } catch (err) {
      summary.errors += 1;
      log.error(`Scheduler: location ${location_id} failed —`, err.message);

      // Log the failure so it's visible in the app activity log
      await logEvent({
        locationId: location_id,
        eventType:  'scheduler.cycle',
        status:     'error',
        title:      'Scheduled sync failed',
        detail:     err.message,
        payload:    {},
      }).catch(() => {}); // swallow logEvent errors
    }
  }

  const durationMs = Date.now() - startedAt;
  _lastRunAt = new Date().toISOString();
  _lastStats = { ...summary, durationMs };

  log.info(
    `Scheduler: cycle complete in ${(durationMs / 1000).toFixed(1)}s —`,
    `${summary.synced}/${summary.total} locations synced,`,
    `${summary.analyzed} new analyses,`,
    `${summary.errors} error(s)`
  );

  _running = false;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start the scheduler.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param {{ intervalMs?: number, runImmediately?: boolean }} [opts]
 */
function start({ intervalMs, runImmediately = false } = {}) {
  if (_timer) return; // already running

  const enabled = process.env.SCHEDULER_ENABLED !== 'false';
  if (!enabled) {
    log.info('Scheduler: disabled via SCHEDULER_ENABLED=false');
    return;
  }

  const interval = intervalMs
    ?? (Number(process.env.SCHEDULER_INTERVAL_MINUTES) * 60 * 1000 || DEFAULT_INTERVAL_MS);

  log.info(`Scheduler: starting — interval every ${Math.round(interval / 60000)} min`);

  const kickoff = runImmediately ? 0 : STARTUP_DELAY_MS;

  // First run: after startup delay (or immediately if requested)
  setTimeout(() => {
    runCycle().catch((err) => log.error('Scheduler: unhandled cycle error —', err.message));

    // Subsequent runs: on fixed interval
    _timer = setInterval(() => {
      runCycle().catch((err) => log.error('Scheduler: unhandled cycle error —', err.message));
    }, interval);

    // Allow the Node process to exit cleanly even if the timer is pending
    if (_timer.unref) _timer.unref();
  }, kickoff);
}

/**
 * Stop the scheduler (useful for graceful shutdown or tests).
 */
function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log.info('Scheduler: stopped');
  }
}

/**
 * Returns current scheduler status — used by /health endpoint.
 */
function status() {
  return {
    enabled:    process.env.SCHEDULER_ENABLED !== 'false',
    running:    _running,
    lastRunAt:  _lastRunAt,
    lastStats:  _lastStats,
    intervalMs: Number(process.env.SCHEDULER_INTERVAL_MINUTES) * 60 * 1000 || DEFAULT_INTERVAL_MS,
  };
}

module.exports = { start, stop, runCycle, status };
