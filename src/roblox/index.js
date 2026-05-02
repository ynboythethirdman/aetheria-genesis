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
const { createBrowserController, launch, login, createAccount, changeDisplayName, sendFriendRequest, joinGame, joinOwnerGame, sendChat, readChat, executeMovement, performEmote, followPlayer, isKicked, shutdown } = require('./browser/automation');
const { createMovementController, getNextMovement, MOVE_STATE, setState } = require('./behavior/movement');
const { createSocialController, getResponse, getProactiveComment, getJokeComment, recordChatObservation, addSquadIdentifier } = require('./behavior/social');
const { createStealthController, maybeHumanError, handleKick, markRejoined } = require('./behavior/stealth');
const { parseCommand, executeCommand } = require('./commands/godConsole');
const { sleep, randomDelay, randomBetween, chance } = require('./utils/timing');
const { createVibeSquadDashboard } = require('./dashboard/server');
const crypto = require('crypto');

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
    console.log('[VibeSquad] No ROBLOX_GAME_URL set — bots will auto-detect owner\'s game');
  }

  const eventBus = new EventEmitter();
  const squad = getSquad();

  // Start dashboard
  const dashboard = createVibeSquadDashboard(eventBus);
  await dashboard.start();

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

      // Auth flow: cookie > password > auto-create account
      if (bot.credentials.cookie) {
        await bot.browser.context.addCookies([{
          name: '.ROBLOSECURITY',
          value: bot.credentials.cookie,
          domain: '.roblox.com',
          path: '/',
          httpOnly: true,
          secure: true,
        }]);
        console.log(`[VibeSquad] ${bot.persona.username} using cookie auth`);
      } else if (bot.credentials.password) {
        const loggedIn = await login(bot.browser);
        if (!loggedIn) {
          console.error(`[VibeSquad] ${bot.persona.username} login failed — skipping`);
          await shutdown(bot.browser);
          continue;
        }
      } else {
        // No credentials — try auto account creation
        console.log(`[VibeSquad] ${bot.persona.username} — no credentials, attempting auto signup...`);
        const suffix = crypto.randomBytes(2).toString('hex');
        // Roblox allows only one underscore — strip underscores from base name
        const baseName = bot.persona.username.replace(/_/g, '');
        const autoUsername = `${baseName}_${suffix}`;
        const autoPassword = `VibeSquad_${crypto.randomBytes(6).toString('base64url')}!`;

        const created = await createAccount(bot.browser, {
          username: autoUsername,
          password: autoPassword,
          birthMonth: randomBetween(1, 12),
          birthDay: randomBetween(1, 28),
          birthYear: randomBetween(2003, 2007),
        });

        if (created) {
          console.log(`[VibeSquad] ${bot.persona.username} account created as: ${autoUsername}`);
          // Register auto-created username with all bots' social controllers
          for (const b of bots) {
            addSquadIdentifier(b.social, autoUsername);
          }
          // Set display name to metro-themed name
          await changeDisplayName(bot.browser, bot.persona.displayName);
        } else {
          console.warn(`[VibeSquad] ${bot.persona.username} auto-signup failed (likely CAPTCHA) — running in limited mode`);
        }
      }

      // Send friend request to owner (T0rzyz)
      console.log(`[VibeSquad] ${bot.persona.username} sending friend request to ${config.roblox.ownerUsername}...`);
      await sendFriendRequest(bot.browser, config.roblox.ownerUsername);

      // Join game: use explicit URL if set, otherwise auto-detect owner's game
      if (gameUrl) {
        await joinGame(bot.browser, gameUrl);
      } else {
        const joined = await joinOwnerGame(bot.browser, config.roblox.ownerUsername);
        if (!joined) {
          console.log(`[VibeSquad] ${bot.persona.username} — owner not in a game yet, will poll...`);
        }
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

  // If no explicit game URL, poll owner's game and auto-join when they start playing
  if (!gameUrl && activeBots.length > 0) {
    startOwnerGamePoller(activeBots, squadState);
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

  // Handle commands from the dashboard web UI
  eventBus.on('dashboard:command', async (data) => {
    const command = parseCommand(config.roblox.ownerUsername, `=${data.command}`, config.roblox.ownerUsername);
    if (command) {
      const result = executeCommand(command, squadState, eventBus);
      if (result.handled) {
        console.log(`[Dashboard] ${command.name}: ${result.response}`);
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
          await sleep(response.delay);
          await sendChat(bot.browser, response.text);
          eventBus.emit('bot:chat', { bot: bot.persona.username, message: response.text });
        }
      }

      // Occasionally make proactive comments or jokes
      if (chance(0.15)) {
        const jokeResult = getJokeComment(bot.social);
        if (jokeResult) {
          await sleep(jokeResult.delay);
          await sendChat(bot.browser, jokeResult.text);
          eventBus.emit('bot:chat', { bot: bot.persona.username, message: jokeResult.text });
        }
      } else {
        const proactive = await getProactiveComment(bot.social, {
          nearbyPlayers: [],
          gameContext: 'hanging out in a Roblox game',
        });

        if (proactive) {
          await sleep(proactive.delay);
          await sendChat(bot.browser, proactive.text);
          eventBus.emit('bot:chat', { bot: bot.persona.username, message: proactive.text });
        }
      }
    } catch (err) {
      console.error(`[ChatLoop:${bot.persona.username}] Error: ${err.message}`);
    }

    // Schedule next tick with jitter (stop if bot was permanently kicked)
    const interval = config.squad.tickIntervalMs + randomBetween(-500, 500);
    if (bot.isRunning) setTimeout(tick, interval);
  };

  // Start with random offset so bots don't tick in sync
  setTimeout(tick, randomBetween(1000, 5000));
}

// ── Loop: Movement ──────────────────────────────────────────────────

function startMovementLoop(bot, squadState) {
  let followAttemptCounter = 0;

  const tick = async () => {
    try {
      // Periodically try to click-follow the owner in tethered/regrouping mode
      followAttemptCounter++;
      if (bot.movement.state !== 'free' && followAttemptCounter % 5 === 0) {
        await followPlayer(bot.browser, config.roblox.ownerUsername);
      }

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
    if (bot.isRunning) setTimeout(tick, interval);
  };

  setTimeout(tick, randomBetween(2000, 6000));
}

// ── Loop: Stealth (Human Errors) ────────────────────────────────────

function startStealthLoop(bot, squadState) {
  const tick = async () => {
    if (!squadState.stealthMode) {
      if (bot.isRunning) setTimeout(tick, 10000);
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
    if (bot.isRunning) setTimeout(tick, interval);
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
        eventBus.emit('bot:kick', { bot: bot.persona.username });
        const plan = handleKick(bot.stealth);

        if (plan.shouldRejoin) {
          console.log(`[KickWatch:${bot.persona.username}] Rejoining in ${Math.round(plan.delayMs / 1000)}s...`);
          await sleep(plan.delayMs);

          // Attempt rejoin
          const gameUrl = config.roblox.gameUrl;
          let rejoined = false;
          if (gameUrl) {
            rejoined = await joinGame(bot.browser, gameUrl);
          } else {
            rejoined = await joinOwnerGame(bot.browser, config.roblox.ownerUsername);
          }
          if (rejoined) {
            markRejoined(bot.stealth);
            console.log(`[KickWatch:${bot.persona.username}] Rejoined successfully`);
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

// ── Loop: Owner Game Poller ─────────────────────────────────────────
// Polls the owner's presence and auto-joins bots to whatever game
// the owner is currently in. Runs every 30s until all bots have joined.

function startOwnerGamePoller(activeBots) {
  let allJoined = false;

  const tick = async () => {
    if (allJoined) return;

    try {
      // Use the first bot's browser to check presence
      const scout = activeBots[0];
      if (!scout.isRunning) {
        setTimeout(tick, 30000);
        return;
      }

      const joined = await joinOwnerGame(scout.browser, config.roblox.ownerUsername);
      if (joined) {
        console.log(`[VibeSquad] Owner is in a game — joining all bots...`);
        // Join remaining bots with staggered timing
        for (let i = 1; i < activeBots.length; i++) {
          if (!activeBots[i].isRunning) continue;
          await randomDelay(2000, 5000);
          await joinOwnerGame(activeBots[i].browser, config.roblox.ownerUsername);
        }
        allJoined = true;
        console.log('[VibeSquad] All bots joined owner\'s game');
        return;
      }
    } catch (err) {
      console.error(`[GamePoller] Error: ${err.message}`);
    }

    // Poll every 30 seconds
    setTimeout(tick, 30000);
  };

  // Start polling after a short delay
  setTimeout(tick, 5000);
}

// ── Run ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[VibeSquad] Fatal error:', err);
  process.exit(1);
});
