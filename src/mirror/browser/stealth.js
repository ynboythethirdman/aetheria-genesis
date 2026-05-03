/**
 * Mirror — Browser Stealth Helpers
 *
 * Anti-detection: random viewports, mouse noise, keystroke timing,
 * user-agent rotation, and popup dismissal.
 */

const { randomBetween, randomPick, sleep, chance } = require('../utils/timing');

function getRandomViewport() {
  return randomPick([
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]);
}

function getRandomUserAgent() {
  return randomPick([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ]);
}

function getRandomTimezone() {
  return randomPick([
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'Europe/London',
  ]);
}

function addMouseNoise(targetX, targetY) {
  return {
    x: targetX + randomBetween(-3, 3),
    y: targetY + randomBetween(-3, 3),
  };
}

function generateMousePath(fromX, fromY, toX, toY, steps) {
  steps = steps || randomBetween(5, 15);
  const points = [];
  const ctrlX = (fromX + toX) / 2 + randomBetween(-50, 50);
  const ctrlY = (fromY + toY) / 2 + randomBetween(-30, 30);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const invT = 1 - t;
    const x = invT * invT * fromX + 2 * invT * t * ctrlX + t * t * toX;
    const y = invT * invT * fromY + 2 * invT * t * ctrlY + t * t * toY;
    points.push({
      x: Math.round(x + randomBetween(-2, 2)),
      y: Math.round(y + randomBetween(-2, 2)),
    });
  }
  return points;
}

function getKeystrokeDelays(text) {
  const delays = [];
  for (let i = 0; i < text.length; i++) {
    let baseDelay = randomBetween(30, 120);
    if (text[i] === ' ') baseDelay += randomBetween(10, 40);
    if (i > 0 && '.!?,'.includes(text[i - 1])) baseDelay += randomBetween(50, 150);
    if (chance(0.05)) baseDelay += randomBetween(200, 500);
    delays.push(baseDelay);
  }
  return delays;
}

module.exports = {
  getRandomViewport,
  getRandomUserAgent,
  getRandomTimezone,
  addMouseNoise,
  generateMousePath,
  getKeystrokeDelays,
};
