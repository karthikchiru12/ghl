'use strict';

const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger('chutes');

const BASE_URL   = process.env.CHUTES_BASE_URL    || 'https://llm.chutes.ai/v1';
const MODEL      = process.env.CHUTES_MINIMAX_MODEL || 'minimaxai/Minimax-M2.5';
const API_KEY    = process.env.CHUTES_API_KEY;

if (!API_KEY) {
  log.warn('CHUTES_API_KEY is not set — analysis calls will fail at runtime');
}

/**
 * Send a chat completion request to Chutes AI.
 * Returns the parsed content string from the first choice.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [options]
 * @param {number} [options.maxTokens=1024]
 * @param {number} [options.temperature=0.2]   low temp for deterministic JSON
 * @returns {Promise<string>}
 */
async function chatComplete(messages, { maxTokens = 1024, temperature = 0.2 } = {}) {
  if (!API_KEY) throw new Error('CHUTES_API_KEY is not configured');

  log.debug('Sending request to Chutes model:', MODEL);

  const response = await axios.post(
    `${BASE_URL}/chat/completions`,
    {
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from Chutes API');
  log.debug('Chutes response received, length:', content.length);
  return content;
}

/**
 * Parse a strict JSON blob out of a possibly-markdown-wrapped LLM response.
 * Extracts from ```json ... ``` fences if present.
 */
function extractJson(raw) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object found in LLM response');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { chatComplete, extractJson };
