/**
 * Aetheria Genesis — Central Configuration
 *
 * All tunables live here. Override via environment variables in Replit Secrets.
 */

module.exports = {
  // ── Minecraft Server ──────────────────────────────────────────────────
  minecraft: {
    host: process.env.MC_HOST || 'localhost',
    port: parseInt(process.env.MC_PORT || '25565', 10),
    version: process.env.MC_VERSION || '1.21.4',
  },

  // ── Agent Fleet ───────────────────────────────────────────────────────
  agents: {
    count: parseInt(process.env.AGENT_COUNT || '100', 10),
    spawnDelay: parseInt(process.env.SPAWN_DELAY_MS || '5000', 10),
    tickInterval: parseInt(process.env.TICK_INTERVAL_MS || '10000', 10),
    chatRadius: parseInt(process.env.CHAT_RADIUS || '32', 10),
    gossipChance: parseFloat(process.env.GOSSIP_CHANCE || '0.3'),
  },

  // ── LLM Provider ─────────────────────────────────────────────────────
  llm: {
    provider: process.env.LLM_PROVIDER || 'groq',           // 'groq' | 'openrouter'
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '256', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.9'),
    rateLimit: parseInt(process.env.LLM_RATE_LIMIT_MS || '200', 10),
  },

  // ── Memory (Upstash Redis) ────────────────────────────────────────────
  redis: {
    url: process.env.UPSTASH_REDIS_URL || '',
    token: process.env.UPSTASH_REDIS_TOKEN || '',
  },

  // ── Dashboard ─────────────────────────────────────────────────────────
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  },
};
