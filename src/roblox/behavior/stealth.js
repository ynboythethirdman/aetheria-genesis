/**
 * Vibe Squad — Technical Stealth System
 *
 * Anti-detection measures: human error injection, kick handling,
 * browser fingerprint randomization, and behavioral noise.
 */

const { chance, randomBetween, randomPick, sleep } = require('../utils/timing');
const { generateHumanError } = require('./movement');
const config = require('../config');

/**
 * Create a stealth controller for a single bot.
 *
 * @param {string} botId
 * @returns {object} Stealth controller
 */
function createStealthController(botId) {
  return {
    botId,
    kickCount: 0,
    lastKickTime: 0,
    isRejoining: false,
    errorHistory: [],
    sessionStartTime: Date.now(),
  };
}

/**
 * Decide if a human error should occur this tick.
 * Returns an error action if so, null otherwise.
 */
function maybeHumanError(controller) {
  if (!chance(config.squad.humanErrorChance)) return null;

  const error = generateHumanError();
  controller.errorHistory.push({
    type: error.type,
    time: Date.now(),
  });

  // Keep error history bounded
  if (controller.errorHistory.length > 50) {
    controller.errorHistory.shift();
  }

  return error;
}

/**
 * Handle being kicked from the game.
 * Implements a randomized rejoin delay to avoid immediate re-detection.
 *
 * @param {object} controller
 * @returns {object} Rejoin plan { shouldRejoin, delayMs }
 */
function handleKick(controller) {
  controller.kickCount++;
  controller.lastKickTime = Date.now();
  controller.isRejoining = true;

  // Exponential backoff with jitter based on kick count
  const baseDelay = config.squad.rejoinDelayMs;
  const multiplier = Math.min(controller.kickCount, 5);
  const delayMs = baseDelay * multiplier + randomBetween(0, 30000);

  // After 5 kicks, give up
  if (controller.kickCount >= 5) {
    return { shouldRejoin: false, delayMs: 0, reason: 'max_kicks_reached' };
  }

  return { shouldRejoin: true, delayMs, reason: 'kicked' };
}

/**
 * Mark the bot as successfully rejoined.
 */
function markRejoined(controller) {
  controller.isRejoining = false;
}

/**
 * Get random viewport dimensions to vary browser fingerprint.
 * Returns common screen resolutions that look natural.
 */
function getRandomViewport() {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ];
  return randomPick(viewports);
}

/**
 * Generate random mouse movement noise.
 * Adds slight imprecision to mouse actions to look human.
 *
 * @param {number} targetX - Intended X position
 * @param {number} targetY - Intended Y position
 * @returns {{x: number, y: number}} Slightly offset position
 */
function addMouseNoise(targetX, targetY) {
  const noiseX = randomBetween(-3, 3);
  const noiseY = randomBetween(-3, 3);
  return {
    x: targetX + noiseX,
    y: targetY + noiseY,
  };
}

/**
 * Generate a realistic mouse path between two points.
 * Uses bezier-like interpolation with noise.
 *
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {number} steps - Number of intermediate points
 * @returns {Array<{x: number, y: number}>}
 */
function generateMousePath(fromX, fromY, toX, toY, steps) {
  steps = steps || randomBetween(5, 15);
  const points = [];

  // Add slight curve via a random control point
  const ctrlX = (fromX + toX) / 2 + randomBetween(-50, 50);
  const ctrlY = (fromY + toY) / 2 + randomBetween(-30, 30);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;

    // Quadratic bezier
    const x = invT * invT * fromX + 2 * invT * t * ctrlX + t * t * toX;
    const y = invT * invT * fromY + 2 * invT * t * ctrlY + t * t * toY;

    // Add micro noise
    points.push({
      x: Math.round(x + randomBetween(-2, 2)),
      y: Math.round(y + randomBetween(-2, 2)),
    });
  }

  return points;
}

/**
 * Get random delays between keystrokes for typing.
 * Simulates natural typing rhythm with variable gaps.
 *
 * @param {string} text - The text being typed
 * @returns {number[]} Array of delays (ms) between each character
 */
function getKeystrokeDelays(text) {
  const delays = [];
  for (let i = 0; i < text.length; i++) {
    let baseDelay = randomBetween(30, 120);

    // Spaces are slightly slower (finger reaches)
    if (text[i] === ' ') baseDelay += randomBetween(10, 40);

    // After punctuation, slightly longer pause
    if (i > 0 && '.!?,'.includes(text[i - 1])) {
      baseDelay += randomBetween(50, 150);
    }

    // Occasional longer pause (thinking)
    if (chance(0.05)) baseDelay += randomBetween(200, 500);

    delays.push(baseDelay);
  }
  return delays;
}

module.exports = {
  createStealthController,
  maybeHumanError,
  handleKick,
  markRejoined,
  getRandomViewport,
  addMouseNoise,
  generateMousePath,
  getKeystrokeDelays,
};
