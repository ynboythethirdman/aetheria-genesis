/**
 * Vibe Squad — Social Behavior System
 *
 * Manages chat engagement, spam prevention, bot-detection deflection,
 * and proactive social interactions. Ensures bots behave like
 * casual human players.
 */

const { generateResponse, generateProactiveComment, generateDeflection } = require('../brain/chat');
const { getTypingDelay, chance, randomPick, randomBetween } = require('../utils/timing');
const config = require('../config');

// Bot-detection keywords that trigger deflection
const BOT_KEYWORDS = [
  'bot', 'bots', 'are you a bot', 'ur a bot', 'you a bot',
  'is that a bot', 'definitely a bot', 'scripting', 'macro',
  'automated', 'npc', 'ai', 'chatgpt', 'robot',
];

/**
 * Create a social controller for a single bot.
 *
 * @param {object} persona - The bot's persona definition
 * @returns {object} Social controller instance
 */
function createSocialController(persona) {
  return {
    persona,
    lastChatTime: 0,
    consecutiveMessages: 0,
    recentMessages: [],          // Ring buffer of recent sent messages
    chatHistory: [],             // Recent chat we've observed
    isChatty: false,
    engagementScore: 0,          // Tracks how engaged the bot is
    mentionedPlayers: new Set(), // Players we've already commented on
  };
}

/**
 * Decide if the bot should respond to a chat message.
 *
 * @param {object} controller - Social controller
 * @param {string} sender - Who sent the message
 * @param {string} message - The message content
 * @returns {boolean} Whether the bot should respond
 */
function shouldRespond(controller, sender, message) {
  const now = Date.now();
  const { persona } = controller;
  const cooldown = controller.isChatty
    ? config.squad.chatCooldownMs / config.squad.chattyMultiplier
    : config.squad.chatCooldownMs;

  // Cooldown check
  if (now - controller.lastChatTime < cooldown) return false;

  // Anti-spam: don't send too many messages in a row
  if (controller.consecutiveMessages >= config.squad.maxConsecutiveMessages) {
    controller.consecutiveMessages = 0;
    return false;
  }

  // Don't respond to ourselves or other squad members
  const squadNames = ['zachy_vibs', 'luna_sky7', 'not_jason'];
  if (squadNames.includes(sender)) return false;

  // Don't repeat exact messages we've recently sent
  const lowerMsg = message.toLowerCase();

  // Always respond to direct mentions
  if (lowerMsg.includes(persona.username) || lowerMsg.includes(persona.displayName.toLowerCase())) {
    return true;
  }

  // Bot detection — always deflect
  if (isBotAccusation(message)) return true;

  // Chatty mode: higher response chance
  if (controller.isChatty) {
    return chance(0.6);
  }

  // Normal mode: respond based on personality energy
  return chance(persona.personality.friendliness * 0.3);
}

/**
 * Generate a response to a player's message.
 *
 * @param {object} controller - Social controller
 * @param {string} sender - Who sent the message
 * @param {string} message - What they said
 * @param {object} context - Game context
 * @returns {Promise<{text: string, delay: number} | null>} Response with typing delay
 */
async function getResponse(controller, sender, message, context) {
  if (!shouldRespond(controller, sender, message)) return null;

  const { persona } = controller;
  let responseText;

  // Bot accusation — use pre-written deflection
  if (isBotAccusation(message)) {
    responseText = generateDeflection(persona);
  } else {
    // Generate LLM response with context
    const chatContext = {
      recentChat: controller.chatHistory.slice(-8),
      nearbyPlayers: context.nearbyPlayers || [],
      gameContext: context.gameContext || '',
    };
    responseText = await generateResponse(persona, sender, message, chatContext);
  }

  // Anti-duplicate: don't send if we recently said the same thing
  if (isDuplicate(controller, responseText)) {
    return null;
  }

  const delay = getTypingDelay(responseText);

  // Update state
  controller.lastChatTime = Date.now() + delay;
  controller.consecutiveMessages++;
  recordSentMessage(controller, responseText);

  return { text: responseText, delay };
}

/**
 * Generate a proactive comment (unprompted social engagement).
 * Called periodically to make bots seem active and social.
 *
 * @param {object} controller - Social controller
 * @param {object} context - Game context
 * @returns {Promise<{text: string, delay: number} | null>}
 */
async function getProactiveComment(controller, context) {
  const now = Date.now();
  const { persona } = controller;

  const cooldown = controller.isChatty
    ? config.squad.chatCooldownMs
    : config.squad.chatCooldownMs * 3;

  if (now - controller.lastChatTime < cooldown) return null;

  // Decide whether to comment
  const commentChance = controller.isChatty
    ? persona.personality.energy * 0.5
    : persona.personality.energy * 0.15;

  if (!chance(commentChance)) return null;

  let text;

  // Sometimes use pre-written idle comments for speed
  if (chance(0.4)) {
    text = randomPick(persona.idleComments);
  } else if (context.nearbyPlayers && context.nearbyPlayers.length > 0 && chance(0.3)) {
    // Comment on a nearby player
    const target = randomPick(context.nearbyPlayers);
    if (!controller.mentionedPlayers.has(target)) {
      controller.mentionedPlayers.add(target);
      text = await generatePlayerComment(persona, target, context);
    } else {
      text = await generateProactiveComment(persona, context);
    }
  } else {
    text = await generateProactiveComment(persona, context);
  }

  if (!text || isDuplicate(controller, text)) return null;

  const delay = getTypingDelay(text);
  controller.lastChatTime = Date.now() + delay;
  controller.consecutiveMessages = 0;
  recordSentMessage(controller, text);

  return { text, delay };
}

/**
 * Generate a comment about a specific player (e.g., "nice skin @Player").
 */
async function generatePlayerComment(persona, playerName, context) {
  const comments = [
    `nice skin @${playerName}`,
    `@${playerName} that was cool`,
    `yo @${playerName}`,
    `${playerName} is going off`,
  ];

  // Sometimes use a simple template, sometimes use LLM
  if (chance(0.6)) {
    return randomPick(comments);
  }

  return generateProactiveComment(persona, {
    ...context,
    gameContext: `You notice ${playerName} nearby and want to say something to them.`,
  });
}

/**
 * Check if a message is accusing the bot of being a bot.
 */
function isBotAccusation(message) {
  const lower = message.toLowerCase();
  return BOT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Check if a message is a duplicate of something recently sent.
 */
function isDuplicate(controller, text) {
  const lower = text.toLowerCase().trim();
  return controller.recentMessages.some(
    (m) => m.toLowerCase().trim() === lower
  );
}

/**
 * Record a sent message in the ring buffer.
 */
function recordSentMessage(controller, text) {
  controller.recentMessages.push(text);
  if (controller.recentMessages.length > 20) {
    controller.recentMessages.shift();
  }
}

/**
 * Record an observed chat message.
 */
function recordChatObservation(controller, sender, text) {
  controller.chatHistory.push({ sender, text, time: Date.now() });
  if (controller.chatHistory.length > 30) {
    controller.chatHistory.shift();
  }
}

/**
 * Toggle chatty mode.
 */
function setChatty(controller, enabled) {
  controller.isChatty = enabled;
}

module.exports = {
  createSocialController,
  shouldRespond,
  getResponse,
  getProactiveComment,
  recordChatObservation,
  setChatty,
  isBotAccusation,
};
