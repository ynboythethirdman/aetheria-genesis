/**
 * Vibe Squad — Roblox Configuration
 *
 * All tunables for the Roblox bot squad. Inherits LLM and Redis
 * settings from the main Aetheria config, adds Roblox-specific options.
 */

const baseConfig = require('../config');

module.exports = {
  // Inherit shared services
  llm: baseConfig.llm,
  redis: baseConfig.redis,

  // ── Roblox ──────────────────────────────────────────────────────────
  roblox: {
    gameUrl: process.env.ROBLOX_GAME_URL || '',
    ownerUsername: process.env.ROBLOX_OWNER || 'T0rzyz',
  },

  // ── Squad Behavior ──────────────────────────────────────────────────
  squad: {
    // Tethering — how close bots stay to the owner
    tetherRadius: parseInt(process.env.TETHER_RADIUS || '15', 10),
    tetherMinDist: parseInt(process.env.TETHER_MIN_DIST || '3', 10),

    // Timing
    tickIntervalMs: parseInt(process.env.SQUAD_TICK_MS || '3000', 10),
    chatCooldownMs: parseInt(process.env.CHAT_COOLDOWN_MS || '8000', 10),
    idleActionIntervalMs: parseInt(process.env.IDLE_ACTION_MS || '12000', 10),

    // Typing simulation (WPM range)
    typingWpmMin: parseInt(process.env.TYPING_WPM_MIN || '40', 10),
    typingWpmMax: parseInt(process.env.TYPING_WPM_MAX || '60', 10),

    // Chat
    chattyMultiplier: parseFloat(process.env.CHATTY_MULTIPLIER || '3.0'),
    maxConsecutiveMessages: parseInt(process.env.MAX_CONSECUTIVE_MSGS || '2', 10),

    // Stealth
    humanErrorChance: parseFloat(process.env.HUMAN_ERROR_CHANCE || '0.08'),
    rejoinDelayMs: parseInt(process.env.REJOIN_DELAY_MS || '180000', 10),
  },

  // ── Dashboard ───────────────────────────────────────────────────────
  dashboard: {
    port: parseInt(process.env.VIBE_DASHBOARD_PORT || '3001', 10),
  },
};
