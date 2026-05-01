/**
 * LLM Client — Unified interface for Groq and OpenRouter APIs.
 *
 * Handles rate-limiting, retries, and provider abstraction so the
 * cognitive loop never has to care which backend is running.
 */

const axios = require('axios');
const config = require('../config');

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    header: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    header: (key) => ({
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://aetheria-genesis.replit.app',
      'X-Title': 'Aetheria Genesis',
    }),
  },
};

// Simple token-bucket rate limiter
let lastCall = 0;

async function rateLimit() {
  const now = Date.now();
  const wait = config.llm.rateLimit - (now - lastCall);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCall = Date.now();
}

/**
 * Send a prompt to the LLM and return the assistant's reply text.
 *
 * @param {string} systemPrompt - The system-level instructions
 * @param {string} userPrompt   - The user-level (agent-level) query
 * @returns {Promise<string>}   - The LLM response text
 */
async function think(systemPrompt, userPrompt) {
  await rateLimit();

  const provider = PROVIDERS[config.llm.provider];
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${config.llm.provider}`);
  }

  if (!config.llm.apiKey) {
    return '[No LLM API key configured — returning placeholder thought]';
  }

  const payload = {
    model: config.llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
  };

  try {
    const res = await axios.post(provider.url, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...provider.header(config.llm.apiKey),
      },
      timeout: 30000,
    });
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[LLM] Error (${status}): ${msg}`);

    // Retry once on rate-limit
    if (status === 429) {
      const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return think(systemPrompt, userPrompt);
    }
    return `[LLM error: ${msg}]`;
  }
}

module.exports = { think };
