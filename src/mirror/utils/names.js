/**
 * Mirror — Username / Password Generator
 *
 * Generates random Roblox-style usernames and secure passwords.
 */

const crypto = require('crypto');
const { randomBetween, randomPick } = require('./timing');

const ADJECTIVES = [
  'Cool', 'Epic', 'Fast', 'Dark', 'Wild', 'Ice', 'Fire', 'Sky',
  'Blue', 'Red', 'Neon', 'Star', 'Gold', 'Iron', 'Mega', 'Ultra',
  'Pro', 'Max', 'Ace', 'Zen', 'Nova', 'Void', 'Grim', 'Fury',
];

const NOUNS = [
  'Player', 'Gamer', 'Wolf', 'Fox', 'Bear', 'Hawk', 'Lion', 'Tiger',
  'Knight', 'Ninja', 'Storm', 'Blade', 'Spark', 'Ghost', 'Shadow', 'Flame',
  'Comet', 'Vortex', 'Titan', 'Raven', 'Cobra', 'Drake', 'Lynx', 'Puma',
];

function generateUsername() {
  const adj = randomPick(ADJECTIVES);
  const noun = randomPick(NOUNS);
  const num = randomBetween(10, 9999);
  const name = `${adj}${noun}${num}`;
  return name.length <= 20 ? name : name.slice(0, 20);
}

function generatePassword(length) {
  length = length || 14;
  const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let password = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += charset[bytes[i] % charset.length];
  }
  return password;
}

module.exports = { generateUsername, generatePassword };
