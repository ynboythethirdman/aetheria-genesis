/**
 * Vibe Squad — Chat Brain
 *
 * Uses Groq API to generate natural, persona-aware responses.
 * Each bot's speech style, personality, and context shape the LLM prompt
 * so responses feel authentic and casual.
 */

const { think } = require('../../llm/client');
const { randomPick, chance } = require('../utils/timing');

/**
 * Build system prompt for a specific squad member persona.
 */
function buildSystemPrompt(persona) {
  const style = persona.speechStyle;
  return `You are pretending to be a casual Roblox player named "${persona.username}".
You are NOT an AI. You are a real human teenager/young adult playing Roblox for fun.

Your personality: ${persona.backstory}

STRICT RULES FOR YOUR RESPONSES:
- Write in ${style.capitalization} case. ${style.punctuation === 'minimal' ? 'Barely use punctuation.' : style.punctuation === 'rare' ? 'Almost never use punctuation.' : 'Use some punctuation but keep it casual.'}
- Use slang naturally: ${style.slang.join(', ')}
- Keep messages SHORT. Max ${style.maxSentenceLength} words per message. Most should be 3-8 words.
- You make typos occasionally. You're typing fast on a keyboard.
- Never use proper grammar or full sentences. Talk like you're texting a friend.
- Never mention AI, language models, or being programmed.
- Never be overly helpful or formal. You're just a kid playing a game.
- If you don't know something, say "${randomPick(persona.speechStyle.fillers)}" or something vague.
- Your interests: ${persona.interests.join(', ')}
- You can use these emojis sparingly: ${style.emojis.join(' ')}

RESPOND WITH ONLY THE CHAT MESSAGE. No quotes, no labels, no explanations. Just the raw message.`;
}

/**
 * Generate a natural response to a player's message.
 *
 * @param {object} persona - The bot's persona definition
 * @param {string} playerName - Who said the message
 * @param {string} playerMessage - What they said
 * @param {object} context - Game context (nearby players, recent chat, etc.)
 * @returns {Promise<string>} The bot's response
 */
async function generateResponse(persona, playerName, playerMessage, context) {
  const systemPrompt = buildSystemPrompt(persona);

  let userPrompt = `Someone just talked to you in the Roblox game chat.

${playerName}: "${playerMessage}"

`;

  if (context.recentChat && context.recentChat.length > 0) {
    userPrompt += 'Recent chat history:\n';
    for (const msg of context.recentChat.slice(-5)) {
      userPrompt += `  ${msg.sender}: ${msg.text}\n`;
    }
    userPrompt += '\n';
  }

  if (context.nearbyPlayers && context.nearbyPlayers.length > 0) {
    userPrompt += `Other players nearby: ${context.nearbyPlayers.join(', ')}\n`;
  }

  if (context.gameContext) {
    userPrompt += `Game situation: ${context.gameContext}\n`;
  }

  userPrompt += '\nRespond naturally as your character. Keep it short and casual.';

  const response = await think(systemPrompt, userPrompt);
  return postProcess(persona, response);
}

/**
 * Generate a proactive comment (not in response to anyone).
 * Used for idle chatter, game commentary, compliments, etc.
 *
 * @param {object} persona - The bot's persona definition
 * @param {object} context - Game context
 * @returns {Promise<string>} A spontaneous comment
 */
async function generateProactiveComment(persona, context) {
  const systemPrompt = buildSystemPrompt(persona);

  let userPrompt = 'You\'re playing a Roblox game and want to say something in chat. '
    + 'You\'re NOT responding to anyone — just making a casual comment.\n\n';

  if (context.nearbyPlayers && context.nearbyPlayers.length > 0) {
    userPrompt += `Players nearby: ${context.nearbyPlayers.join(', ')}\n`;
  }
  if (context.gameContext) {
    userPrompt += `What's happening: ${context.gameContext}\n`;
  }

  userPrompt += '\nSay something casual. Could be about the game, a random thought, '
    + 'or a comment to someone nearby. Keep it very short.';

  const response = await think(systemPrompt, userPrompt);
  return postProcess(persona, response);
}

/**
 * Generate a deflection when accused of being a bot.
 *
 * @param {object} persona - The bot's persona definition
 * @returns {string} A deflection response
 */
function generateDeflection(persona) {
  return randomPick(persona.deflections);
}

/**
 * Post-process LLM output to match the persona's style.
 * Strips quotes, enforces casing, and injects typos/emojis.
 */
function postProcess(persona, raw) {
  let text = raw
    .replace(/^["']|["']$/g, '')
    .replace(/^\*.*\*\s*/g, '')
    .trim();

  // Enforce capitalization style
  if (persona.speechStyle.capitalization === 'lowercase') {
    text = text.toLowerCase();
  }

  // Strip trailing periods (casual players don't end with periods)
  text = text.replace(/\.$/g, '');

  // Truncate to max sentence length
  const words = text.split(/\s+/);
  if (words.length > persona.speechStyle.maxSentenceLength) {
    text = words.slice(0, persona.speechStyle.maxSentenceLength).join(' ');
  }

  // Inject occasional emoji
  if (chance(persona.speechStyle.emojiFrequency) && !hasEmoji(text)) {
    text += ' ' + randomPick(persona.speechStyle.emojis);
  }

  // Inject occasional typo
  if (chance(persona.speechStyle.typoChance)) {
    text = injectTypo(text);
  }

  return text;
}

/**
 * Check if a string already contains emoji.
 */
function hasEmoji(text) {
  return /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/u.test(text);
}

/**
 * Inject a realistic typo into a message.
 */
function injectTypo(text) {
  const words = text.split(' ');
  if (words.length < 2) return text;

  const idx = Math.floor(Math.random() * words.length);
  const word = words[idx];
  if (word.length < 3) return text;

  const typoType = Math.random();
  if (typoType < 0.33) {
    // Swap two adjacent characters
    const pos = Math.floor(Math.random() * (word.length - 1));
    const chars = word.split('');
    [chars[pos], chars[pos + 1]] = [chars[pos + 1], chars[pos]];
    words[idx] = chars.join('');
  } else if (typoType < 0.66) {
    // Double a character
    const pos = Math.floor(Math.random() * word.length);
    words[idx] = word.slice(0, pos) + word[pos] + word.slice(pos);
  } else {
    // Skip a character
    const pos = 1 + Math.floor(Math.random() * (word.length - 2));
    words[idx] = word.slice(0, pos) + word.slice(pos + 1);
  }

  return words.join(' ');
}

module.exports = {
  generateResponse,
  generateProactiveComment,
  generateDeflection,
  buildSystemPrompt,
  postProcess,
};
