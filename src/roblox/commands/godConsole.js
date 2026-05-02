/**
 * Vibe Squad — God Console
 *
 * Command system for the owner (T0rzyz) to control the squad.
 * Commands start with "=" and are intercepted from chat.
 *
 * Commands:
 *   =free       — Bots stop following, enter Social Mode (wander + chat)
 *   =squad      — Bots regroup on owner and follow again
 *   =vibe [E]   — All bots perform emote E with the owner
 *   =chatty     — Toggle increased chattiness
 *   =status     — Report squad status
 *   =stealth    — Toggle extra stealth behaviors
 */

const { MOVE_STATE, setState } = require('../behavior/movement');
const { setChatty } = require('../behavior/social');

const COMMAND_PREFIX = '=';

/**
 * Parse a chat message for God Console commands.
 *
 * @param {string} sender - Who sent the message
 * @param {string} message - The raw chat message
 * @param {string} ownerUsername - The owner's Roblox username
 * @returns {object|null} Parsed command { name, args } or null
 */
function parseCommand(sender, message, ownerUsername) {
  // Only the owner can issue commands
  if (sender !== ownerUsername) return null;

  // Must start with command prefix
  if (!message.startsWith(COMMAND_PREFIX)) return null;

  const parts = message.slice(COMMAND_PREFIX.length).trim().split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { name, args };
}

/**
 * Execute a God Console command across all bots.
 *
 * @param {object} command - Parsed command { name, args }
 * @param {object} squad - Squad state { bots: [{movement, social, browser}] }
 * @param {object} eventBus - Event emitter for dashboard updates
 * @returns {object} Result { handled, response, actions }
 */
function executeCommand(command, squad, eventBus) {
  const { name, args } = command;

  switch (name) {
    case 'free':
      return handleFree(squad, eventBus);

    case 'squad':
      return handleSquad(squad, eventBus);

    case 'vibe':
      return handleVibe(args, squad, eventBus);

    case 'chatty':
      return handleChatty(squad, eventBus);

    case 'status':
      return handleStatus(squad);

    case 'stealth':
      return handleStealth(squad, eventBus);

    default:
      return { handled: false, response: null, actions: [] };
  }
}

/**
 * =free — Enter Social Mode.
 * Bots stop following and wander independently.
 */
function handleFree(squad, eventBus) {
  const actions = [];

  for (const bot of squad.bots) {
    setState(bot.movement, MOVE_STATE.FREE);
    setChatty(bot.social, true);
    actions.push({
      botId: bot.id,
      action: 'enter_free_mode',
    });
  }

  if (eventBus) {
    eventBus.emit('squad:mode_change', { mode: 'free' });
  }

  return {
    handled: true,
    response: 'Squad released — Social Mode active',
    actions,
  };
}

/**
 * =squad — Regroup and follow.
 * Bots return to the owner and resume tethered movement.
 */
function handleSquad(squad, eventBus) {
  const actions = [];

  for (const bot of squad.bots) {
    setState(bot.movement, MOVE_STATE.REGROUPING);
    setChatty(bot.social, false);
    actions.push({
      botId: bot.id,
      action: 'regroup',
    });
  }

  if (eventBus) {
    eventBus.emit('squad:mode_change', { mode: 'squad' });
  }

  return {
    handled: true,
    response: 'Squad regrouping — Follow Mode active',
    actions,
  };
}

/**
 * =vibe [emote] — Perform an emote together.
 */
function handleVibe(args, squad, eventBus) {
  const emote = args.join(' ') || 'dance';
  const actions = [];

  for (const bot of squad.bots) {
    actions.push({
      botId: bot.id,
      action: 'emote',
      emote,
    });
  }

  if (eventBus) {
    eventBus.emit('squad:emote', { emote });
  }

  return {
    handled: true,
    response: `Squad vibing — ${emote}`,
    actions,
  };
}

/**
 * =chatty — Toggle chattiness.
 */
function handleChatty(squad, eventBus) {
  // Toggle based on first bot's current state
  const newState = !squad.bots[0]?.social?.isChatty;

  for (const bot of squad.bots) {
    setChatty(bot.social, newState);
  }

  if (eventBus) {
    eventBus.emit('squad:chatty', { enabled: newState });
  }

  return {
    handled: true,
    response: `Chatty mode ${newState ? 'ON' : 'OFF'}`,
    actions: [],
  };
}

/**
 * =status — Report current squad status.
 */
function handleStatus(squad) {
  const status = squad.bots.map((bot) => ({
    id: bot.id,
    username: bot.persona.username,
    moveState: bot.movement.state,
    chatty: bot.social.isChatty,
    kicks: bot.stealth.kickCount,
    position: bot.movement.position,
  }));

  return {
    handled: true,
    response: JSON.stringify(status, null, 2),
    actions: [],
  };
}

/**
 * =stealth — Toggle extra stealth behaviors.
 */
function handleStealth(squad, eventBus) {
  const newState = !squad.stealthMode;
  squad.stealthMode = !squad.stealthMode;

  if (eventBus) {
    eventBus.emit('squad:stealth', { enabled: newState });
  }

  return {
    handled: true,
    response: `Stealth mode ${newState ? 'ON' : 'OFF'}`,
    actions: [],
  };
}

module.exports = {
  COMMAND_PREFIX,
  parseCommand,
  executeCommand,
};
