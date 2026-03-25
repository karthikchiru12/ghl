'use strict';

const { Router } = require('express');
const { analyseCall, analysePendingCalls } = require('../services/analysis');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log = createLogger('routes:analyze');
const router = Router({ mergeParams: true });

// POST /api/locations/:locationId/calls/:callId/analyze
// Run Chutes Minimax M2.5 analysis on a specific call
router.post('/:callId/analyze', async (req, res) => {
  const { locationId, callId } = req.params;

  try {
    const result = await analyseCall(callId, locationId);
    return res.json({ ok: true, analysis: result });
  } catch (err) {
    log.error(`Analysis failed for call ${callId}:`, err.message);
    return res.status(err.status ?? 500).json({ ok: false, error: err.message });
  }
});

// POST /api/locations/:locationId/analyze-pending?limit=20
// Analyse calls without an existing analysis (up to limit)
router.post('/analyze-pending', async (req, res) => {
  const { locationId } = req.params;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  try {
    const results = await analysePendingCalls(locationId, { limit });
    const succeeded = results.filter((r) => r.ok).length;
    const failed    = results.filter((r) => !r.ok).length;
    return res.json({ ok: true, summary: { total: results.length, succeeded, failed }, results });
  } catch (err) {
    log.error('analysePendingCalls error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/locations/:locationId/calls/:callId/analysis
// Return stored analysis for a specific call
router.get('/:callId/analysis', async (req, res) => {
  const { callId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM call_analyses WHERE call_id = $1 LIMIT 1`,
      [callId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'No analysis found for this call' });
    }
    return res.json({ ok: true, analysis: result.rows[0] });
  } catch (err) {
    log.error(`Failed to fetch analysis for ${callId}:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
