'use strict';

const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger('chutes');

const BASE_URL = process.env.CHUTES_BASE_URL     || 'https://llm.chutes.ai/v1';
const MODEL    = process.env.CHUTES_MINIMAX_MODEL || 'minimaxai/Minimax-M2.5';
const API_KEY  = process.env.CHUTES_API_KEY;

if (!API_KEY) {
  log.warn('CHUTES_API_KEY is not set — analysis calls will fail at runtime');
}

/**
 * Send a chat completion request to Chutes AI.
 * Retries up to MAX_RETRIES times on transient server-side errors (5xx, ECONNRESET).
 * Returns the content string from the first choice.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [options]
 * @param {number} [options.maxTokens=1024]
 * @param {number} [options.temperature=0.2]
 * @returns {Promise<string>}
 */
async function chatComplete(messages, { maxTokens = 1024, temperature = 0.2 } = {}) {
  if (!API_KEY) throw new Error('CHUTES_API_KEY is not configured');

  const MAX_RETRIES = 2;
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.debug(`Sending request to Chutes model: ${MODEL} (attempt ${attempt + 1})`);

      const response = await axios.post(
        `${BASE_URL}/chat/completions`,
        { model: MODEL, messages, max_tokens: maxTokens, temperature },
        {
          headers: {
            Authorization:  `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60_000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from Chutes API');

      log.debug('Chutes response received, length:', content.length);
      return content;
    } catch (err) {
      lastErr = err;
      const httpStatus = err.response?.status;
      const isRetriable = (httpStatus >= 500) || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';

      if (attempt < MAX_RETRIES && isRetriable) {
        const delay = 1500 * (attempt + 1);
        log.warn(`LLM request failed (${httpStatus ?? err.code}), retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastErr;
}

/**
 * Parse a strict JSON blob out of a possibly-markdown-wrapped LLM response.
 * Handles ```json ... ``` fences, and bare JSON objects.
 *
 * @param {string} raw
 * @returns {object}
 */
function extractJson(raw) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object found in LLM response');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { chatComplete, extractJson };
