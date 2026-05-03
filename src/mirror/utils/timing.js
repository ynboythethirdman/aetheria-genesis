/**
 * Mirror — Timing Utilities
 *
 * Human-like delays and randomization helpers.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  const delay = randomBetween(minMs, maxMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(probability) {
  return Math.random() < probability;
}

module.exports = { sleep, randomDelay, randomBetween, randomPick, chance };
