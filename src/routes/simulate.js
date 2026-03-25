'use strict';

const crypto   = require('crypto');
const { Router } = require('express');
const { transcribeAudio } = require('../lib/whisper');
const { pool } = require('../db/pool');
const { createLogger } = require('../lib/logger');

const log    = createLogger('routes:simulate');
const router = Router({ mergeParams: true });

/**
 * POST /api/locations/:locationId/simulate-call
 *
 * Accepts browser-recorded audio, transcribes via Chutes Whisper,
 * and stores the result in call_logs in the same schema as GHL calls.
 * This bypasses the 20-min/day sandbox web-call limit.
 */
router.post('/', async (req, res) => {
  const { locationId } = req.params;
  const { audioBase64, agentId, contactName, language } = req.body;

  if (!audioBase64) {
    return res.status(400).json({ ok: false, error: 'audioBase64 is required' });
  }

  try {
    // 1. Transcribe via Chutes Whisper
    const { text, chunks } = await transcribeAudio(audioBase64, language);

    if (!text?.trim()) {
      return res.status(422).json({ ok: false, error: 'No speech detected in audio' });
    }

    // 2. Build transcript array matching GHL's shape
    //    Whisper chunks give us timestamped segments from a single speaker.
    //    For a simulated call the entire recording is the "user" side.
    const transcript = chunks?.length
      ? chunks.map((c) => ({
          role:    'user',
          content: c.text?.trim() ?? '',
          start:   c.start,
          end:     c.end,
        })).filter((t) => t.content)
      : [{ role: 'user', content: text }];

    // 3. Derive duration from last chunk's end timestamp, or estimate from text length
    const durationSeconds = chunks?.length
      ? Math.ceil(chunks[chunks.length - 1].end)
      : Math.round(text.length / 15);

    // 4. Generate a unique simulated call ID
    const callId = `sim_${crypto.randomUUID()}`;

    // 5. Insert into call_logs — same schema as GHL-synced calls
    await pool.query(
      `INSERT INTO call_logs
         (call_id, agent_id, location_id, transcript, summary,
          extracted_data, executed_actions, duration_seconds,
          status, started_at, ended_at, raw, synced_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9,NOW(),NULL,$10::jsonb,NOW())`,
      [
        callId,
        agentId || null,
        locationId,
        JSON.stringify(transcript),
        contactName
          ? `Simulated call — ${contactName} — ${text.slice(0, 100)}`
          : `Simulated call — ${text.slice(0, 120)}`,
        JSON.stringify(null),
        JSON.stringify(null),
        durationSeconds,
        'simulated',
        JSON.stringify({
          simulated:     true,
          contactName:   contactName || null,
          transcribedAt: new Date().toISOString(),
          whisperChunks: chunks.length,
        }),
      ]
    );

    log.info(`Simulated call ${callId} stored for location ${locationId} (${durationSeconds}s)`);
    return res.json({ ok: true, callId, duration: durationSeconds, transcript: text.slice(0, 300) });
  } catch (err) {
    log.error('Simulate call failed:', err.message);
    const status = err.response?.status ?? 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

module.exports = router;
