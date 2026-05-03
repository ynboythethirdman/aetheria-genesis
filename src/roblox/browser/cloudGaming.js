/**
 * Vibe Squad — Cloud Gaming Adapter (now.gg)
 *
 * Runs Roblox through now.gg cloud gaming service so bots can play
 * without a local Roblox installation. Streams the Android Roblox
 * app in the browser and automates it via screen-based interaction.
 *
 * Architecture:
 *   Playwright browser → now.gg page → Android Roblox stream → game world
 *   All interaction is through clicks/keys on the stream canvas element.
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { sleep, randomDelay, randomBetween } = require('../utils/timing');
const config = require('../config');
const path = require('path');
const fs = require('fs');

// ── now.gg URLs ──────────────────────────────────────────────────────
const NOWGG_BASE = 'https://now.gg';
const NOWGG_ROBLOX = 'https://now.gg/apps/roblox-corporation/5349/roblox.html';

// Map popular Roblox place IDs to now.gg deep-link pages
const NOWGG_GAME_MAP = {
  '920587237': `${NOWGG_BASE}/apps/adopt-me/19912/adopt-me.html`,
  '4252370517': `${NOWGG_BASE}/apps/Brookhaven/19905/Brookhaven.html`,
  '2753915549': `${NOWGG_BASE}/apps/Blox-fruit/19901/Blox-fruit.html`,
};

// ── Mobile Roblox UI coordinates (relative to canvas, normalized 0-1) ──
// These are approximate positions for the Android Roblox mobile UI
const MOBILE_UI = {
  // Login screen
  loginUsernameField: { x: 0.5, y: 0.35 },
  loginPasswordField: { x: 0.5, y: 0.45 },
  loginButton: { x: 0.5, y: 0.58 },
  signupLink: { x: 0.5, y: 0.70 },

  // Home screen
  searchBar: { x: 0.5, y: 0.08 },
  firstGameResult: { x: 0.5, y: 0.30 },

  // In-game controls
  chatButton: { x: 0.08, y: 0.55 },
  chatInput: { x: 0.5, y: 0.92 },
  chatSend: { x: 0.95, y: 0.92 },
  joystickCenter: { x: 0.15, y: 0.80 },
  jumpButton: { x: 0.88, y: 0.78 },
  menuButton: { x: 0.05, y: 0.05 },

  // Game page
  playButton: { x: 0.5, y: 0.65 },
};

// ── Selectors for now.gg's web page ──────────────────────────────────
const NOWGG_SELECTORS = {
  playButton: 'button:has-text("Play in Browser"), button:has-text("Play Now"), [class*="play-btn"], a:has-text("Play")',
  gameCanvas: 'canvas, iframe[src*="nowcloud"], div[class*="game-container"] canvas, div[class*="player-container"]',
  gameIframe: 'iframe[src*="nowcloud"], iframe[src*="now.gg"], iframe[class*="game"]',
  queueMessage: ':text("queue"), :text("waiting"), :text("position")',
  overloadedMessage: ':text("overloaded"), :text("Catching up")',
  loginPrompt: 'button:has-text("Log In"), button:has-text("Sign In"), a:has-text("Log In")',
};

/**
 * Create a cloud gaming controller for a single bot.
 */
function createCloudController(persona, credentials) {
  return {
    persona,
    credentials,
    browser: null,
    context: null,
    page: null,
    isConnected: false,
    isInGame: false,
    isCloudSession: true,
    streamElement: null,  // The canvas/iframe element of the cloud game
    streamBounds: null,   // { x, y, width, height } of the stream element
    lastScreenshot: null,
    chatObserver: null,
    lastChatSnapshot: [],
    viewport: { width: 1280, height: 720 },
    mousePosition: { x: 0, y: 0 },
  };
}

/**
 * Launch the browser and open now.gg.
 */
async function launchCloud(controller) {
  const { viewport } = controller;

  controller.browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${viewport.width},${viewport.height}`,
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  controller.context = await controller.browser.newContext({
    viewport,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['notifications'],
  });

  controller.page = await controller.context.newPage();
  controller.isConnected = true;

  console.log(`[Cloud:${controller.persona.username}] Browser launched`);
}

/**
 * Navigate to now.gg and start a Roblox cloud session.
 *
 * @param {object} controller
 * @param {string} [gameUrl] - Optional specific game URL or place ID
 * @returns {Promise<boolean>} Whether the cloud session started
 */
async function startCloudSession(controller, gameUrl) {
  const { page, persona } = controller;

  // Determine which now.gg page to use
  let targetUrl = NOWGG_ROBLOX;

  if (gameUrl) {
    // Check if we have a deep-link for this game
    const placeId = extractPlaceId(gameUrl);
    if (placeId && NOWGG_GAME_MAP[placeId]) {
      targetUrl = NOWGG_GAME_MAP[placeId];
      console.log(`[Cloud:${persona.username}] Using deep-link for place ${placeId}`);
    }
  }

  try {
    console.log(`[Cloud:${persona.username}] Opening ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Check if servers are overloaded
    const isOverloaded = await page.$(':text("overloaded")').catch(() => null);
    if (isOverloaded) {
      console.log(`[Cloud:${persona.username}] now.gg servers overloaded — will retry`);
      return false;
    }

    // Dismiss any popups, cookie banners
    await dismissNowggPopups(page);

    // Click "Play in Browser" button
    const playBtn = await page.waitForSelector(
      NOWGG_SELECTORS.playButton,
      { timeout: 15000 }
    ).catch(() => null);

    if (playBtn) {
      await playBtn.click();
      console.log(`[Cloud:${persona.username}] Clicked Play — waiting for cloud session...`);
    } else {
      // Maybe it auto-loads, or there's no explicit play button
      console.log(`[Cloud:${persona.username}] No play button found, checking for stream...`);
    }

    // Wait for the cloud game stream to appear
    const streamReady = await waitForStream(controller, 120000);  // 2 min timeout
    if (!streamReady) {
      console.log(`[Cloud:${persona.username}] Cloud session failed to start`);
      return false;
    }

    console.log(`[Cloud:${persona.username}] Cloud session active!`);
    return true;
  } catch (err) {
    console.error(`[Cloud:${persona.username}] Failed to start cloud session: ${err.message}`);
    return false;
  }
}

/**
 * Wait for the cloud game stream canvas/iframe to become available.
 */
async function waitForStream(controller, timeout) {
  const { page, persona } = controller;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Look for canvas or iframe that contains the game stream
    const canvas = await page.$(NOWGG_SELECTORS.gameCanvas).catch(() => null);
    const iframe = await page.$(NOWGG_SELECTORS.gameIframe).catch(() => null);

    const streamEl = canvas || iframe;
    if (streamEl) {
      const box = await streamEl.boundingBox();
      if (box && box.width > 100 && box.height > 100) {
        controller.streamElement = streamEl;
        controller.streamBounds = box;
        console.log(`[Cloud:${persona.username}] Stream detected: ${box.width}x${box.height} at (${box.x},${box.y})`);
        return true;
      }
    }

    // Check for queue position
    const queueText = await page.$eval(
      ':text("position"), :text("queue"), :text("waiting")',
      (el) => el.textContent
    ).catch(() => null);

    if (queueText) {
      console.log(`[Cloud:${persona.username}] In queue: ${queueText.trim().substring(0, 80)}`);
    }

    await sleep(3000);
  }

  return false;
}

/**
 * Click at a position within the cloud game stream.
 * Coordinates are normalized (0-1) relative to the stream canvas.
 */
async function streamClick(controller, normX, normY) {
  const { page, streamBounds } = controller;
  if (!streamBounds) return;

  const absX = streamBounds.x + (normX * streamBounds.width);
  const absY = streamBounds.y + (normY * streamBounds.height);

  await page.mouse.click(absX, absY);
  await randomDelay(200, 500);
}

/**
 * Type text into the currently focused element in the stream.
 */
async function streamType(controller, text, humanLike) {
  const { page } = controller;

  if (humanLike) {
    for (const char of text) {
      await page.keyboard.type(char, { delay: randomBetween(40, 120) });
    }
  } else {
    await page.keyboard.type(text, { delay: 30 });
  }
}

/**
 * Press a key in the stream.
 */
async function streamKey(controller, key) {
  const { page } = controller;
  await page.keyboard.press(key);
  await randomDelay(50, 150);
}

/**
 * Take a screenshot of the stream area for state detection.
 */
async function streamScreenshot(controller) {
  const { page, streamBounds, persona } = controller;
  if (!streamBounds) return null;

  const screenshotDir = path.join(__dirname, '..', '..', '..', '.vibe-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const filePath = path.join(screenshotDir, `${persona.username}_stream.png`);
  await page.screenshot({
    path: filePath,
    clip: {
      x: streamBounds.x,
      y: streamBounds.y,
      width: streamBounds.width,
      height: streamBounds.height,
    },
  });

  controller.lastScreenshot = filePath;
  return filePath;
}

/**
 * Log into Roblox within the cloud-streamed mobile app.
 */
async function cloudLogin(controller, username, password) {
  const { persona } = controller;

  console.log(`[Cloud:${persona.username}] Logging into Roblox as ${username}...`);

  // Wait for the Roblox app to load within the stream
  await sleep(5000);

  // Take a screenshot to check state
  await streamScreenshot(controller);

  // The Android Roblox app should show a login/signup screen
  // Click on username field
  await streamClick(controller, MOBILE_UI.loginUsernameField.x, MOBILE_UI.loginUsernameField.y);
  await randomDelay(500, 1000);

  // Type username
  await streamType(controller, username, true);
  await randomDelay(300, 700);

  // Click on password field
  await streamClick(controller, MOBILE_UI.loginPasswordField.x, MOBILE_UI.loginPasswordField.y);
  await randomDelay(500, 1000);

  // Type password
  await streamType(controller, password, true);
  await randomDelay(300, 700);

  // Click login button
  await streamClick(controller, MOBILE_UI.loginButton.x, MOBILE_UI.loginButton.y);
  await randomDelay(3000, 5000);

  // Take screenshot to verify login
  const screenshot = await streamScreenshot(controller);
  console.log(`[Cloud:${persona.username}] Login attempted — screenshot saved to ${screenshot}`);

  return true;
}

/**
 * Join a game within the cloud-streamed Roblox app.
 * Uses the in-app search to find and join the game.
 */
async function cloudJoinGame(controller, gameUrlOrId) {
  const { persona } = controller;
  const placeId = extractPlaceId(gameUrlOrId) || gameUrlOrId;

  console.log(`[Cloud:${persona.username}] Joining game ${placeId} in cloud...`);

  // Tap on search bar
  await streamClick(controller, MOBILE_UI.searchBar.x, MOBILE_UI.searchBar.y);
  await randomDelay(800, 1500);

  // Type the place ID or game name
  await streamType(controller, placeId, false);
  await randomDelay(1500, 2500);

  // Press Enter to search
  await streamKey(controller, 'Enter');
  await randomDelay(2000, 3000);

  // Tap on first result
  await streamClick(controller, MOBILE_UI.firstGameResult.x, MOBILE_UI.firstGameResult.y);
  await randomDelay(2000, 3000);

  // Tap Play button on game detail page
  await streamClick(controller, MOBILE_UI.playButton.x, MOBILE_UI.playButton.y);
  await randomDelay(5000, 8000);

  controller.isInGame = true;
  console.log(`[Cloud:${persona.username}] Game join attempted`);

  // Take screenshot for verification
  await streamScreenshot(controller);
  return true;
}

/**
 * Send a chat message within the cloud-streamed game.
 */
async function cloudSendChat(controller, message) {
  const { persona } = controller;

  // Press "/" to open chat (universal Roblox chat shortcut)
  await streamKey(controller, '/');
  await randomDelay(500, 1000);

  // Type message with human-like delays
  await streamType(controller, message, true);
  await randomDelay(200, 500);

  // Press Enter to send
  await streamKey(controller, 'Enter');
  await randomDelay(300, 600);

  console.log(`[Cloud:${persona.username}] Chat: ${message}`);
  return true;
}

/**
 * Execute a movement in the cloud-streamed game.
 * Uses WASD keys for movement since the stream captures keyboard input.
 */
async function cloudMove(controller, direction, durationMs) {
  const { page } = controller;
  durationMs = durationMs || randomBetween(500, 2000);

  const keyMap = {
    forward: 'w',
    backward: 's',
    left: 'a',
    right: 'd',
    jump: ' ',
  };

  const key = keyMap[direction] || 'w';

  // Hold key for duration
  await page.keyboard.down(key);
  await sleep(durationMs);
  await page.keyboard.up(key);
  await randomDelay(100, 300);
}

/**
 * Perform an emote in the cloud-streamed game.
 * Uses the /e command syntax.
 */
async function cloudPerformEmote(controller, emoteName) {
  const emoteCommands = {
    wave: '/e wave',
    dance: '/e dance',
    dance2: '/e dance2',
    dance3: '/e dance3',
    point: '/e point',
    laugh: '/e laugh',
    cheer: '/e cheer',
  };

  const cmd = emoteCommands[emoteName] || `/e ${emoteName}`;
  await cloudSendChat(controller, cmd);
}

/**
 * Navigate to a player's profile to follow/friend them.
 * In mobile Roblox, this is done through the player list (Esc menu).
 */
async function cloudFollowPlayer(controller, targetUsername) {
  const { persona } = controller;
  console.log(`[Cloud:${persona.username}] Following ${targetUsername} (screen-based)...`);

  // Press Tab or Esc to open player list
  await streamKey(controller, 'Tab');
  await randomDelay(1000, 2000);

  // Take screenshot to check player list
  await streamScreenshot(controller);

  // Close player list
  await streamKey(controller, 'Tab');
  await randomDelay(500, 1000);

  return true;
}

/**
 * Shut down the cloud gaming session.
 */
async function cloudShutdown(controller) {
  const { persona } = controller;

  try {
    if (controller.browser) {
      await controller.browser.close();
    }
    controller.isConnected = false;
    controller.isInGame = false;
    console.log(`[Cloud:${persona.username}] Session closed`);
  } catch (err) {
    console.error(`[Cloud:${persona.username}] Shutdown error: ${err.message}`);
  }
}

/**
 * Detect player presence using the Roblox API directly (not through the stream).
 * This works independently of the cloud gaming session.
 */
async function getPlayerPresenceAPI(ownerUsername) {
  // First resolve username to userId
  try {
    const userResp = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [ownerUsername], excludeBannedUsers: true }),
    });
    const userData = await userResp.json();
    if (!userData.data || userData.data.length === 0) return null;

    const userId = userData.data[0].id;

    // Get presence — this is a public API, no auth needed for basic presence
    const presResp = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] }),
    });
    const presData = await presResp.json();
    if (!presData.userPresences || presData.userPresences.length === 0) return null;

    const presence = presData.userPresences[0];
    return {
      userId,
      userPresenceType: presence.userPresenceType,
      lastLocation: presence.lastLocation,
      placeId: presence.placeId,
      rootPlaceId: presence.rootPlaceId,
      universeId: presence.universeId,
      gameId: presence.gameId,
    };
  } catch (err) {
    console.error(`[Cloud] Failed to get presence for ${ownerUsername}: ${err.message}`);
    return null;
  }
}

/**
 * Start the cloud gaming poller: monitors owner's game and manages bot sessions.
 */
async function startCloudPoller(controller, ownerUsername, onGameDetected) {
  const { persona } = controller;

  console.log(`[Cloud:${persona.username}] Polling for ${ownerUsername}'s game...`);

  const pollInterval = 30000; // 30 seconds
  let lastPlaceId = null;

  const poll = async () => {
    try {
      const presence = await getPlayerPresenceAPI(ownerUsername);

      if (presence && presence.userPresenceType === 2 && presence.rootPlaceId) {
        const placeId = String(presence.rootPlaceId);

        if (placeId !== lastPlaceId) {
          console.log(`[Cloud:${persona.username}] ${ownerUsername} is playing place ${placeId}`);
          lastPlaceId = placeId;

          if (onGameDetected) {
            await onGameDetected(placeId, presence);
          }
        }
      } else if (presence) {
        const types = ['Offline', 'Website', 'In Game', 'In Studio', 'Invisible'];
        console.log(`[Cloud:${persona.username}] ${ownerUsername} status: ${types[presence.userPresenceType] || 'Unknown'}`);
      }
    } catch (err) {
      console.error(`[Cloud:${persona.username}] Poll error: ${err.message}`);
    }
  };

  // Initial poll
  await poll();

  // Continue polling
  const intervalId = setInterval(poll, pollInterval);
  return intervalId;
}

// ── Helper functions ─────────────────────────────────────────────────

/**
 * Extract Roblox place ID from various URL formats.
 */
function extractPlaceId(urlOrId) {
  if (!urlOrId) return null;

  // Already a numeric ID
  if (/^\d+$/.test(urlOrId)) return urlOrId;

  // Extract from URL: /games/12345/... or /games/12345
  const match = urlOrId.match(/\/games\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Dismiss now.gg popups, cookie banners, and login prompts.
 */
async function dismissNowggPopups(page) {
  const popupSelectors = [
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    '[class*="cookie"] button',
    'button[aria-label="Close"]',
    '[class*="modal-close"]',
    '[class*="popup"] button[class*="close"]',
  ];

  for (const sel of popupSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click().catch(() => {});
        await sleep(500);
      }
    } catch {
      // Ignore missing popups
    }
  }
}

/**
 * Retry starting a cloud session with exponential backoff.
 * Handles now.gg server overload gracefully.
 */
async function startCloudSessionWithRetry(controller, gameUrl, maxRetries) {
  maxRetries = maxRetries || 5;
  let delay = 30000; // Start with 30s

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Cloud:${controller.persona.username}] Session attempt ${attempt}/${maxRetries}...`);

    const success = await startCloudSession(controller, gameUrl);
    if (success) return true;

    if (attempt < maxRetries) {
      console.log(`[Cloud:${controller.persona.username}] Retrying in ${delay / 1000}s...`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 120000); // Max 2 min between retries

      // Reload the page for a fresh attempt
      await controller.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  }

  return false;
}

module.exports = {
  createCloudController,
  launchCloud,
  startCloudSession,
  startCloudSessionWithRetry,
  waitForStream,
  streamClick,
  streamType,
  streamKey,
  streamScreenshot,
  cloudLogin,
  cloudJoinGame,
  cloudSendChat,
  cloudMove,
  cloudPerformEmote,
  cloudFollowPlayer,
  cloudShutdown,
  getPlayerPresenceAPI,
  startCloudPoller,
  extractPlaceId,
  NOWGG_GAME_MAP,
  MOBILE_UI,
};
