'use strict';

const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger('whisper');

const WHISPER_URL = process.env.CHUTES_WHISPER_URL || 'https://chutes-whisper-large-v3.chutes.ai/transcribe';
const API_KEY     = process.env.CHUTES_API_KEY;

/**
 * Transcribe audio using Chutes Whisper (whisper-large-v3).
 * Accepts base64-encoded audio (wav, mp3, webm, ogg).
 *
 * @param {string} audioBase64 - Raw base64 audio data (no data-URI prefix)
 * @param {string|null} [language=null] - Optional BCP-47 language hint (e.g. "en")
 * @returns {Promise<{ text: string, chunks: Array<{ start: number, end: number, text: string }> }>}
 */
async function transcribeAudio(audioBase64, language = null) {
  if (!API_KEY) throw new Error('CHUTES_API_KEY is not configured');

  // Strip data-URI prefix if caller forgot
  const base64Data = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');

  log.info('Sending audio to Chutes Whisper for transcription...');

  const response = await axios.post(
    WHISPER_URL,
    { language, audio_b64: base64Data },
    {
      headers: {
        Authorization:  `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    }
  );

  const text   = response.data?.text   ?? '';
  const chunks = response.data?.chunks ?? [];

  log.info(`Transcription complete — ${text.length} chars, ${chunks.length} chunks`);
  return { text, chunks };
}

module.exports = { transcribeAudio };
