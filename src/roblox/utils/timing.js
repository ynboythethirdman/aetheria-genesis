/**
 * Vibe Squad — Timing Utilities
 *
 * Simulates human-like typing speed and random delays
 * to avoid detection as automated behavior.
 */

const config = require('../config');

/**
 * Calculate typing delay for a message based on WPM simulation.
 * Adds jitter to avoid perfectly consistent timing.
 *
 * @param {string} message - The message to "type"
 * @returns {number} Delay in milliseconds
 */
function getTypingDelay(message) {
  const wordCount = message.split(/\s+/).length;
  const wpm = randomBetween(
    config.squad.typingWpmMin,
    config.squad.typingWpmMax
  );
  const baseDelayMs = (wordCount / wpm) * 60 * 1000;

  // Add human jitter: ±20%
  const jitter = baseDelayMs * (Math.random() * 0.4 - 0.2);

  // Minimum 400ms (even short messages take a moment)
  return Math.max(400, Math.floor(baseDelayMs + jitter));
}

/**
 * Random delay within a range.
 *
 * @param {number} minMs
 * @param {number} maxMs
 * @returns {Promise<void>}
 */
function randomDelay(minMs, maxMs) {
  const delay = randomBetween(minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Sleep for a fixed duration.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random integer between min and max (inclusive).
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float between min and max.
 */
function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Pick a random element from an array.
 */
function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Returns true with the given probability (0-1).
 */
function chance(probability) {
  return Math.random() < probability;
}

module.exports = {
  getTypingDelay,
  randomDelay,
  sleep,
  randomBetween,
  randomFloat,
  randomPick,
  chance,
};
