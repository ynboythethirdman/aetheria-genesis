/**
 * Vibe Squad — Main Entry Point
 *
 * Launches 3 autonomous Roblox bots that act as a personal friend group.
 * Each bot has a unique persona, uses Groq API for natural chat,
 * and moves/interacts like a real player.
 *
 * Usage:
 *   ROBLOX_GAME_URL=https://www.roblox.com/games/123456 \
 *   ROBLOX_COOKIE_1=... ROBLOX_COOKIE_2=... ROBLOX_COOKIE_3=... \
 *   node src/roblox/index.js
 */

const { EventEmitter } = require('events');
const config = require('./config');
const { getSquad } = require('./personas/squad');
const { createBrowserController, launch, login, sendFriendRequest, joinGame, sendChat, readChat, executeMovement, performEmote, isKicked, shutdown } = require('./browser/automation');
const { createMovementController, getNextMovement, MOVE_STATE, setState } = require('./behavior/movement');
const { createSocialController, getResponse, getProactiveComment, recordChatObservation } = require('./behavior/social');
const { createStealthController, maybeHumanError, handleKick, markRejoined } = require('./behavior/stealth');
const { parseCommand, executeCommand } = require('./commands/godConsole');
const { sleep, randomDelay, randomBetween } = require('./utils/timing');

EventEmitter.defaultMaxListeners = 50;

/**
 * Main orchestrator — initializes and runs all 3 bots.
 */
async function main() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║         THE VIBE SQUAD v1.0.0             ║');
  console.log('  ║   3 Autonomous Roblox Companions          ║');
  console.log('  ║   "indistinguishable from casual players" ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');

  // Validate configuration
  if (!config.llm.apiKey) {
    console.error('[VibeSquad] ERROR: LLM_API_KEY is required. Set it in your environment.');
    process.exit(1);
  }

  const gameUrl = config.roblox.gameUrl;
  if (!gameUrl) {
    console.warn('[VibeSquad] WARNING: No ROBLOX_GAME_URL set. Bots will need a game URL to join.');
  }

  const eventBus = new EventEmitter();
  const squad = getSquad();

  // ── Initialize bot state for each squad member ──────────────────────
  const bots = squad.map((persona, index) => {
    // Each bot needs its own Roblox credentials via env vars
    const credentials = {
      username: process.env[`ROBLOX_USER_${index + 1}`] || persona.username,
      password: process.env[`ROBLOX_PASS_${index + 1}`] || '',
      cookie: process.env[`ROBLOX_COOKIE_${index + 1}`] || '',
    };

    return {
      id: persona.id,
      persona,
      credentials,
      browser: createBrowserController(persona, credentials),
      movement: createMovementController(persona.id),
      social: createSocialController(persona),
      stealth: createStealthController(persona.id),
      isRunning: false,
    };
  });

  const squadState = {
    bots,
    stealthMode: true,
    ownerPosition: { x: 0, y: 0, z: 0 },
  };

  // ── Launch bots with staggered timing ──────────────────────────────
  console.log(`[VibeSquad] Launching ${bots.length} bots...`);

  for (const bot of bots) {
    try {
      console.log(`[VibeSquad] Launching ${bot.persona.username}...`);
      await launch(bot.browser);

      // Login if credentials are provided
      if (bot.credentials.password) {
        const loggedIn = await login(bot.browser);
        if (!loggedIn) {
          console.error(`[VibeSquad] ${bot.persona.username} login failed — skipping`);
          continue;
        }
      } else if (bot.credentials.cookie) {
        // Set cookie directly for pre-authenticated sessions
        await bot.browser.context.addCookies([{
          name: '.ROBLOSECURITY',
          value: bot.credentials.cookie,
          domain: '.roblox.com',
          path: '/',
          httpOnly: true,
          secure: true,
        }]);
        console.log(`[VibeSquad] ${bot.persona.username} using cookie auth`);
      } else {
        console.warn(`[VibeSquad] ${bot.persona.username} has no credentials — running in limited mode`);
      }

      // Send friend request to owner (T0rzyz)
      console.log(`[VibeSquad] ${bot.persona.username} sending friend request to ${config.roblox.ownerUsername}...`);
      await sendFriendRequest(bot.browser, config.roblox.ownerUsername);

      // Join game if URL is set
      if (gameUrl) {
        await joinGame(bot.browser, gameUrl);
      }

      bot.isRunning = true;

      // Stagger bot launches to look natural
      await randomDelay(3000, 8000);
    } catch (err) {
      console.error(`[VibeSquad] Failed to launch ${bot.persona.username}: ${err.message}`);
    }
  }

  const activeBots = bots.filter((b) => b.isRunning);
  console.log(`[VibeSquad] ${activeBots.length}/${bots.length} bots active`);

  if (activeBots.length === 0) {
    console.log('[VibeSquad] No bots are active. Check credentials and game URL.');
    console.log('[VibeSquad] Running in dry-run mode (no browser, chat brain only)...');
  }

  // ── Start the main loops ──────────────────────────────────────────
  // Only the first bot processes God Console commands to prevent
  // toggles firing N times and emotes duplicating
  for (let i = 0; i < activeBots.length; i++) {
    const bot = activeBots[i];
    startChatLoop(bot, squadState, eventBus, i === 0);
    startMovementLoop(bot, squadState);
    startStealthLoop(bot, squadState);
    startKickWatcher(bot, squadState, eventBus);
  }

  // ── Dashboard event logging ────────────────────────────────────────
  eventBus.on('squad:mode_change', (data) => {
    console.log(`[VibeSquad] Mode: ${data.mode}`);
  });

  eventBus.on('squad:emote', (data) => {
    console.log(`[VibeSquad] Emote: ${data.emote}`);
  });

  eventBus.on('squad:chatty', (data) => {
    console.log(`[VibeSquad] Chatty: ${data.enabled}`);
  });

  console.log('[VibeSquad] All systems online. Listening for commands...');
  console.log(`[VibeSquad] Owner: ${config.roblox.ownerUsername}`);
  console.log(`[VibeSquad] Commands: =free | =squad | =vibe [emote] | =chatty | =status`);

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n[VibeSquad] Shutting down...');
    for (const bot of bots) {
      await shutdown(bot.browser);
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    for (const bot of bots) {
      await shutdown(bot.browser);
    }
    process.exit(0);
  });
}

// ── Loop: Chat Processing ──────────────────────────────────────────

function startChatLoop(bot, squadState, eventBus, isCommandBot) {
  const tick = async () => {
    try {
      // Read new chat messages
      const newMessages = await readChat(bot.browser);

      for (const msg of newMessages) {
        // Record observation for all bots
        recordChatObservation(bot.social, msg.sender, msg.text);

        // All bots detect God Console commands to avoid responding to them,
        // but only the designated command bot actually executes them
        const command = parseCommand(msg.sender, msg.text, config.roblox.ownerUsername);
        if (command) {
          if (isCommandBot) {
            const result = executeCommand(command, squadState, eventBus);
            if (result.handled) {
              console.log(`[GodConsole] ${command.name}: ${result.response}`);

              // Execute emote actions
              for (const action of result.actions) {
                if (action.action === 'emote') {
                  const targetBot = squadState.bots.find((b) => b.id === action.botId);
                  if (targetBot) {
                    await performEmote(targetBot.browser, action.emote);
                  }
                }
              }
            }
          }
          continue;
        }

        // Generate response if appropriate
        const context = {
          nearbyPlayers: [],
          gameContext: 'playing a Roblox game with friends',
        };

        const response = await getResponse(bot.social, msg.sender, msg.text, context);
        if (response) {
          // Wait for typing delay (simulates human typing speed)
          await sleep(response.delay);
          await sendChat(bot.browser, response.text);
        }
      }

      // Occasionally make proactive comments
      const proactive = await getProactiveComment(bot.social, {
        nearbyPlayers: [],
        gameContext: 'hanging out in a Roblox game',
      });

      if (proactive) {
        await sleep(proactive.delay);
        await sendChat(bot.browser, proactive.text);
      }
    } catch (err) {
      console.error(`[ChatLoop:${bot.persona.username}] Error: ${err.message}`);
    }

    // Schedule next tick with jitter
    const interval = config.squad.tickIntervalMs + randomBetween(-500, 500);
    setTimeout(tick, interval);
  };

  // Start with random offset so bots don't tick in sync
  setTimeout(tick, randomBetween(1000, 5000));
}

// ── Loop: Movement ──────────────────────────────────────────────────

function startMovementLoop(bot, squadState) {
  const tick = async () => {
    try {
      const moveAction = getNextMovement(
        bot.movement,
        squadState.ownerPosition,
        { nearbyPlayers: [] }
      );

      await executeMovement(bot.browser, moveAction);
    } catch (err) {
      console.error(`[MoveLoop:${bot.persona.username}] Error: ${err.message}`);
    }

    const interval = randomBetween(1500, 4000);
    setTimeout(tick, interval);
  };

  setTimeout(tick, randomBetween(2000, 6000));
}

// ── Loop: Stealth (Human Errors) ────────────────────────────────────

function startStealthLoop(bot, squadState) {
  const tick = async () => {
    if (!squadState.stealthMode) {
      setTimeout(tick, 10000);
      return;
    }

    try {
      const error = maybeHumanError(bot.stealth);
      if (error) {
        console.log(`[Stealth:${bot.persona.username}] Human error: ${error.description}`);
        // Map each error type to the correct executeMovement action
        let moveAction;
        if (error.type === 'jump_early') {
          moveAction = { type: 'jump', duration: error.duration };
        } else if (error.type === 'menu_check') {
          moveAction = { type: 'idle', action: 'check_menu', duration: error.duration };
        } else {
          moveAction = { type: 'walk', direction: error.keys, duration: error.duration, sprint: false };
        }
        await executeMovement(bot.browser, moveAction);
      }
    } catch (err) {
      console.error(`[StealthLoop:${bot.persona.username}] Error: ${err.message}`);
    }

    const interval = randomBetween(8000, 20000);
    setTimeout(tick, interval);
  };

  setTimeout(tick, randomBetween(5000, 15000));
}

// ── Loop: Kick Detection ────────────────────────────────────────────

function startKickWatcher(bot, squadState, eventBus) {
  const tick = async () => {
    try {
      const kicked = await isKicked(bot.browser);
      if (kicked) {
        console.log(`[KickWatch:${bot.persona.username}] Detected kick!`);
        const plan = handleKick(bot.stealth);

        if (plan.shouldRejoin) {
          console.log(`[KickWatch:${bot.persona.username}] Rejoining in ${Math.round(plan.delayMs / 1000)}s...`);
          await sleep(plan.delayMs);

          // Attempt rejoin
          const gameUrl = config.roblox.gameUrl;
          if (gameUrl) {
            const rejoined = await joinGame(bot.browser, gameUrl);
            if (rejoined) {
              markRejoined(bot.stealth);
              console.log(`[KickWatch:${bot.persona.username}] Rejoined successfully`);
            }
          }
        } else {
          console.log(`[KickWatch:${bot.persona.username}] Max kicks reached — giving up`);
          bot.isRunning = false;
        }
      }
    } catch (err) {
      console.error(`[KickWatch:${bot.persona.username}] Error: ${err.message}`);
    }

    if (bot.isRunning) {
      setTimeout(tick, 15000);
    }
  };

  setTimeout(tick, 10000);
}

// ── Run ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[VibeSquad] Fatal error:', err);
  process.exit(1);
});
