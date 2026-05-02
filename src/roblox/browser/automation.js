/**
 * Vibe Squad — Playwright Browser Automation
 *
 * Controls Roblox through the browser using Playwright.
 * Each bot gets its own browser context with unique fingerprint.
 * Handles: login, game joining, chat I/O, movement input,
 * emote execution, friend requests, and kick detection.
 */

const { chromium } = require('playwright');
const { getRandomViewport, addMouseNoise, generateMousePath, getKeystrokeDelays } = require('../behavior/stealth');
const { sleep, randomDelay, randomBetween, chance } = require('../utils/timing');
const config = require('../config');
const { solveFunCaptcha } = require('./captchaSolver');

// Roblox UI selectors (may need updating as Roblox changes their UI)
const SELECTORS = {
  // Chat
  chatButton: '[class*="chat"] button, [data-testid="chat-button"], .chat-icon',
  chatInput: 'input[class*="chat"], [data-testid="chat-input"], .chat-input input',
  chatMessages: '[class*="chat-message"], [data-testid="chat-message"], .chat-message',
  chatContainer: '[class*="chat-container"], [data-testid="chat-container"], .chat-window',

  // Game canvas
  gameCanvas: 'canvas#game-engine, canvas[class*="game"], canvas',

  // Player list
  playerList: '[class*="player-list"], [data-testid="player-list"]',
  playerListToggle: '[class*="player-list"] button, [data-testid="playerlist-button"]',

  // Menu / UI
  menuButton: '[class*="menu-icon"], [data-testid="menu-button"]',
  leaveButton: '[class*="leave"], [data-testid="leave-game"]',
  emoteMenu: '[class*="emote"], [data-testid="emote-menu"]',

  // Friend request
  friendButton: '[class*="friend"], [data-testid="add-friend"]',
  profileSearch: 'input[class*="search"], [data-testid="search-input"]',

  // Login
  loginUsername: '#login-username, input[name="username"], #loginUsername',
  loginPassword: '#login-password, input[name="password"], #loginPassword',
  loginSubmit: '#login-button, button[type="submit"], .login-button',

  // Cookie consent / popups
  cookieAccept: '[class*="cookie"] button, [data-testid="cookie-accept"]',
  modalClose: '[class*="modal"] [class*="close"], .modal-close, button[aria-label="Close"]',
};

/**
 * Create a browser automation controller for a single bot.
 *
 * @param {object} persona - The bot's persona definition
 * @param {object} credentials - { username, password } for Roblox login
 * @returns {object} Browser controller
 */
function createBrowserController(persona, credentials) {
  return {
    persona,
    credentials,
    browser: null,
    context: null,
    page: null,
    isConnected: false,
    isInGame: false,
    chatObserver: null,
    lastChatSnapshot: [],
    viewport: getRandomViewport(),
    mousePosition: { x: 0, y: 0 },
  };
}

/**
 * Launch the browser and set up the bot's session.
 *
 * @param {object} controller - Browser controller
 * @returns {Promise<void>}
 */
async function launch(controller) {
  const { viewport } = controller;

  controller.browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
  });

  controller.context = await controller.browser.newContext({
    viewport,
    userAgent: getRandomUserAgent(),
    locale: 'en-US',
    timezoneId: getRandomTimezone(),
    // Hide webdriver flag
    javaScriptEnabled: true,
  });

  // Mask automation indicators
  await controller.context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Mask chrome automation
    window.chrome = { runtime: {} };
  });

  controller.page = await controller.context.newPage();
  controller.isConnected = true;

  console.log(`[Browser:${controller.persona.username}] Launched (${viewport.width}x${viewport.height})`);
}

/**
 * Log into Roblox with the bot's credentials.
 *
 * @param {object} controller
 * @returns {Promise<boolean>} Success
 */
async function login(controller) {
  const { page, credentials, persona } = controller;

  try {
    await page.goto('https://www.roblox.com/login', { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(1000, 2000);

    // Dismiss cookie banners / popups
    await dismissPopups(controller);

    // Type username with human-like delays
    const usernameInput = await page.waitForSelector(SELECTORS.loginUsername, { timeout: 10000 });
    await humanType(controller, usernameInput, credentials.username);

    await randomDelay(300, 800);

    // Type password
    const passwordInput = await page.waitForSelector(SELECTORS.loginPassword, { timeout: 5000 });
    await humanType(controller, passwordInput, credentials.password);

    await randomDelay(500, 1200);

    // Click login
    const submitBtn = await page.waitForSelector(SELECTORS.loginSubmit, { timeout: 5000 });
    await humanClick(controller, submitBtn);

    // Wait for navigation
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await randomDelay(2000, 4000);

    console.log(`[Browser:${persona.username}] Login completed`);
    return true;
  } catch (err) {
    console.error(`[Browser:${persona.username}] Login failed: ${err.message}`);
    return false;
  }
}

/**
 * Send a friend request to the owner (T0rzyz).
 *
 * @param {object} controller
 * @param {string} targetUsername - The username to friend (default: owner)
 * @returns {Promise<boolean>} Success
 */
async function sendFriendRequest(controller, targetUsername) {
  const { page, persona } = controller;
  targetUsername = targetUsername || config.roblox.ownerUsername;

  try {
    // Navigate to the target's profile
    await page.goto(`https://www.roblox.com/users/profile?username=${targetUsername}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });
    await randomDelay(1500, 3000);

    // Look for the Add Friend button
    const friendBtn = await page.waitForSelector(
      'button:has-text("Add Friend"), [class*="friend-action"] button, button:has-text("Follow")',
      { timeout: 8000 }
    ).catch(() => null);

    if (friendBtn) {
      const btnText = await friendBtn.textContent();
      if (btnText.toLowerCase().includes('add friend')) {
        await humanClick(controller, friendBtn);
        await randomDelay(1000, 2000);
        console.log(`[Browser:${persona.username}] Sent friend request to ${targetUsername}`);
        return true;
      }
      // Already friends or pending
      console.log(`[Browser:${persona.username}] Already friends/pending with ${targetUsername}`);
      return true;
    }

    console.log(`[Browser:${persona.username}] Could not find friend button for ${targetUsername}`);
    return false;
  } catch (err) {
    console.error(`[Browser:${persona.username}] Friend request failed: ${err.message}`);
    return false;
  }
}

/**
 * Join a Roblox game by URL or place ID.
 *
 * @param {object} controller
 * @param {string} gameUrl - Full Roblox game URL or place ID
 * @returns {Promise<boolean>} Success
 */
async function joinGame(controller, gameUrl) {
  const { page, persona } = controller;

  try {
    // Navigate to game page
    const url = gameUrl.startsWith('http')
      ? gameUrl
      : `https://www.roblox.com/games/${gameUrl}`;

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Click Play button
    const playBtn = await page.waitForSelector(
      'button:has-text("Play"), [class*="play-button"], [data-testid="play-button"]',
      { timeout: 10000 }
    );
    await humanClick(controller, playBtn);

    // Wait for game to load (Roblox opens in the desktop app or browser player)
    await randomDelay(5000, 10000);

    controller.isInGame = true;
    console.log(`[Browser:${persona.username}] Joined game`);
    return true;
  } catch (err) {
    console.error(`[Browser:${persona.username}] Failed to join game: ${err.message}`);
    return false;
  }
}

/**
 * Send a chat message in-game with realistic typing.
 *
 * @param {object} controller
 * @param {string} message - The message to send
 * @returns {Promise<boolean>}
 */
async function sendChat(controller, message) {
  const { page, persona } = controller;

  try {
    // Press "/" to open chat (Roblox default)
    await page.keyboard.press('/');
    await randomDelay(200, 500);

    // Wait for chat input to appear
    const chatInput = await page.waitForSelector(SELECTORS.chatInput, { timeout: 5000 }).catch(() => null);

    if (chatInput) {
      // Type with human-like keystroke delays
      await humanType(controller, chatInput, message);
    } else {
      // Fallback: just type into the focused element
      await humanTypeKeyboard(controller, message);
    }

    await randomDelay(100, 300);

    // Press Enter to send
    await page.keyboard.press('Enter');

    console.log(`[Chat:${persona.username}] ${message}`);
    return true;
  } catch (err) {
    console.error(`[Chat:${persona.username}] Failed to send: ${err.message}`);
    return false;
  }
}

/**
 * Read recent chat messages from the game.
 *
 * @param {object} controller
 * @returns {Promise<Array<{sender: string, text: string}>>} New messages
 */
async function readChat(controller) {
  const { page } = controller;

  try {
    const messages = await page.$$eval(
      SELECTORS.chatMessages,
      (els) => els.map((el) => {
        const senderEl = el.querySelector('[class*="sender"], [class*="username"], .chat-name');
        const textEl = el.querySelector('[class*="message-content"], [class*="text"], .chat-content');
        return {
          sender: senderEl ? senderEl.textContent.trim() : 'Unknown',
          text: textEl ? textEl.textContent.trim() : el.textContent.trim(),
        };
      })
    ).catch(() => []);

    // Filter to only new messages
    const newMessages = messages.filter(
      (msg) => !controller.lastChatSnapshot.some(
        (old) => old.sender === msg.sender && old.text === msg.text
      )
    );

    controller.lastChatSnapshot = messages.slice(-20);
    return newMessages;
  } catch {
    return [];
  }
}

/**
 * Execute a movement action via keyboard input.
 *
 * @param {object} controller
 * @param {object} moveAction - From movement system { type, direction, duration, sprint }
 * @returns {Promise<void>}
 */
async function executeMovement(controller, moveAction) {
  const { page } = controller;

  try {
    switch (moveAction.type) {
      case 'walk': {
        const keys = moveAction.direction || ['w'];
        // Hold shift if sprinting
        if (moveAction.sprint) await page.keyboard.down('Shift');

        // Press movement keys
        for (const key of keys) await page.keyboard.down(key);
        await sleep(moveAction.duration || 500);
        for (const key of keys) await page.keyboard.up(key);

        if (moveAction.sprint) await page.keyboard.up('Shift');
        break;
      }

      case 'jump':
        await page.keyboard.press(' ');
        await sleep(moveAction.duration || 300);
        break;

      case 'look': {
        // Mouse movement for camera rotation
        const canvas = await page.$(SELECTORS.gameCanvas);
        if (canvas) {
          const box = await canvas.boundingBox();
          if (box) {
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            await page.mouse.move(
              centerX + (moveAction.deltaX || 0),
              centerY + (moveAction.deltaY || 0),
              { steps: randomBetween(3, 8) }
            );
          }
        }
        break;
      }

      case 'idle':
        if (moveAction.action === 'check_menu') {
          // Briefly press Esc (looks like checking menu)
          await page.keyboard.press('Escape');
          await sleep(moveAction.duration || 1000);
          await page.keyboard.press('Escape');
        } else {
          // Otherwise just wait
          await sleep(moveAction.duration || 1000);
        }
        break;

      default:
        await sleep(500);
    }
  } catch (err) {
    console.error(`[Movement:${controller.persona.username}] Error: ${err.message}`);
  }
}

/**
 * Perform an emote by typing the emote command.
 *
 * @param {object} controller
 * @param {string} emoteName
 * @returns {Promise<void>}
 */
async function performEmote(controller, emoteName) {
  // Roblox emotes are triggered via /e command
  await sendChat(controller, `/e ${emoteName}`);
}

/**
 * Check if the bot has been kicked from the game.
 *
 * @param {object} controller
 * @returns {Promise<boolean>}
 */
async function isKicked(controller) {
  const { page } = controller;

  try {
    // Check for disconnection dialogs
    const kickDialog = await page.$('text=/kicked|disconnected|banned|removed/i');
    if (kickDialog) {
      controller.isInGame = false;
      return true;
    }

    // Check if game canvas is gone
    const canvas = await page.$(SELECTORS.gameCanvas);
    if (!canvas && controller.isInGame) {
      controller.isInGame = false;
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the browser session.
 *
 * @param {object} controller
 */
async function shutdown(controller) {
  try {
    if (controller.page) await controller.page.close().catch(() => {});
    if (controller.context) await controller.context.close().catch(() => {});
    if (controller.browser) await controller.browser.close().catch(() => {});
    controller.isConnected = false;
    controller.isInGame = false;
    console.log(`[Browser:${controller.persona.username}] Shutdown complete`);
  } catch (err) {
    console.error(`[Browser:${controller.persona.username}] Shutdown error: ${err.message}`);
  }
}

// ── Human-like interaction helpers ──────────────────────────────────

/**
 * Type text into an element with human-like keystroke delays.
 */
async function humanType(controller, element, text) {
  await element.click();
  await randomDelay(100, 300);

  const delays = getKeystrokeDelays(text);
  for (let i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    await sleep(delays[i]);
  }
}

/**
 * Type text using keyboard (no element reference needed).
 */
async function humanTypeKeyboard(controller, text) {
  const delays = getKeystrokeDelays(text);
  for (let i = 0; i < text.length; i++) {
    await controller.page.keyboard.type(text[i], { delay: 0 });
    await sleep(delays[i]);
  }
}

/**
 * Click an element with human-like mouse movement.
 */
async function humanClick(controller, element) {
  const box = await element.boundingBox();
  if (!box) {
    await element.click();
    return;
  }

  // Click slightly off-center (humans aren't pixel-perfect)
  const target = addMouseNoise(
    box.x + box.width / 2,
    box.y + box.height / 2
  );

  // Move mouse naturally
  const path = generateMousePath(
    controller.mousePosition.x,
    controller.mousePosition.y,
    target.x,
    target.y
  );

  for (const point of path) {
    await controller.page.mouse.move(point.x, point.y);
    await sleep(randomBetween(5, 20));
  }

  await controller.page.mouse.click(target.x, target.y);
  controller.mousePosition = target;
}

/**
 * Dismiss any popups, cookie banners, or modals.
 */
async function dismissPopups(controller) {
  const { page } = controller;

  try {
    // Cookie consent
    const cookieBtn = await page.$(SELECTORS.cookieAccept);
    if (cookieBtn) {
      await cookieBtn.click();
      await randomDelay(500, 1000);
    }

    // Modal close buttons
    const closeBtn = await page.$(SELECTORS.modalClose);
    if (closeBtn) {
      await closeBtn.click();
      await randomDelay(300, 800);
    }
  } catch {
    // Popups are optional — ignore failures
  }
}

// ── Randomization helpers ──────────────────────────────────────────

function getRandomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

function getRandomTimezone() {
  const zones = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'Europe/London',
  ];
  return zones[Math.floor(Math.random() * zones.length)];
}

/**
 * Auto-create a Roblox account via the signup page.
 * Fills birthday, username, password and submits.
 * CAPTCHAs may require manual intervention.
 *
 * @param {object} controller
 * @param {object} accountInfo - { username, password, birthMonth, birthDay, birthYear }
 * @returns {Promise<boolean>} Whether signup completed (may still need CAPTCHA)
 */
async function createAccount(controller, accountInfo) {
  const { page, persona } = controller;

  try {
    await page.goto('https://www.roblox.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 4000);
    await dismissPopups(controller);

    // Fill birthday selects (Roblox uses name-based selects with string values)
    const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthSelect = await page.$('select[name="birthdayMonth"]');
    if (monthSelect) {
      await monthSelect.selectOption(MONTHS[accountInfo.birthMonth || 6]);
      await randomDelay(300, 600);
    }

    const daySelect = await page.$('select[name="birthdayDay"]');
    if (daySelect) {
      await daySelect.selectOption(String(accountInfo.birthDay || 15).padStart(2, '0'));
      await randomDelay(300, 600);
    }

    const yearSelect = await page.$('select[name="birthdayYear"]');
    if (yearSelect) {
      await yearSelect.selectOption(String(accountInfo.birthYear || 2005));
      await randomDelay(500, 1000);
    }

    // Fill username
    const usernameInput = await page.$('input[name="signupUsername"]');
    if (usernameInput) {
      await humanType(controller, usernameInput, accountInfo.username);
      await randomDelay(1000, 2000);
    }

    // Fill password
    const passwordInput = await page.$('input[name="signupPassword"]');
    if (passwordInput) {
      await humanType(controller, passwordInput, accountInfo.password);
      await randomDelay(500, 1000);
    }

    // Select gender (optional, random pick)
    if (chance(0.5)) {
      const maleBtn = await page.$('button[title="Male"]');
      if (maleBtn) await humanClick(controller, maleBtn);
    } else {
      const femaleBtn = await page.$('button[title="Female"]');
      if (femaleBtn) await humanClick(controller, femaleBtn);
    }
    await randomDelay(300, 600);

    // Submit signup
    const signupBtn = await page.$('button[name="signupSubmit"]');
    if (signupBtn) {
      await humanClick(controller, signupBtn);
      console.log(`[Browser:${persona.username}] Signup submitted for ${accountInfo.username}`);
    }

    // Wait for CAPTCHA or redirect
    await randomDelay(5000, 10000);

    // Check if CAPTCHA appeared
    const captchaFrame = await page.$('iframe[src*="captcha"], iframe[src*="funcaptcha"], iframe[src*="arkoselabs"], #captcha-container');
    if (captchaFrame) {
      console.log(`[Browser:${persona.username}] CAPTCHA detected — attempting auto-solve with OMO...`);
      const solved = await solveFunCaptcha(controller);
      if (!solved) {
        console.log(`[Browser:${persona.username}] Auto-solve failed — waiting for manual solve...`);
        await page.waitForNavigation({ timeout: 120000 }).catch(() => {
          console.log(`[Browser:${persona.username}] CAPTCHA timeout — may need manual intervention`);
        });
      }
    }

    // Check if we landed on the home page (success)
    const currentUrl = page.url();
    if (currentUrl.includes('/home') || currentUrl.includes('/discover')) {
      console.log(`[Browser:${persona.username}] Account created: ${accountInfo.username}`);
      return true;
    }

    // Check for error messages
    const errorEl = await page.$('.alert-warning, .signup-error, [class*="error"]');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      console.log(`[Browser:${persona.username}] Signup error: ${errorText.trim()}`);
      // Username might be taken — try adding random digits
      return false;
    }

    return false;
  } catch (err) {
    console.error(`[Browser:${persona.username}] Account creation error: ${err.message}`);
    return false;
  }
}

/**
 * Change the display name on the Roblox account.
 *
 * @param {object} controller
 * @param {string} newDisplayName
 * @returns {Promise<boolean>}
 */
async function changeDisplayName(controller, newDisplayName) {
  const { page, persona } = controller;

  try {
    await page.goto('https://www.roblox.com/my/account#!/info', {
      waitUntil: 'networkidle',
      timeout: 20000,
    });
    await randomDelay(2000, 3000);

    // Click the display name edit button/pen icon
    const editBtn = await page.$('button[class*="display-name"] span[class*="edit"], a[href*="display-name"], .display-name-edit');
    if (editBtn) {
      await humanClick(controller, editBtn);
      await randomDelay(500, 1000);
    }

    // Find and clear the display name input
    const nameInput = await page.$('input[id*="display-name"], input[name*="displayName"], input[placeholder*="Display Name"]');
    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await randomDelay(100, 300);
      await humanType(controller, nameInput, newDisplayName);
      await randomDelay(500, 1000);
    }

    // Save
    const saveBtn = await page.$('button:has-text("Save"), button[class*="save"], button[type="submit"]');
    if (saveBtn) {
      await humanClick(controller, saveBtn);
      await randomDelay(2000, 3000);
      console.log(`[Browser:${persona.username}] Display name changed to: ${newDisplayName}`);
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[Browser:${persona.username}] Display name change failed: ${err.message}`);
    return false;
  }
}

/**
 * Follow a player in-game by locating their character on screen.
 * Uses Roblox's click-to-walk toward a player's nameplate.
 *
 * @param {object} controller
 * @param {string} targetUsername - The player to follow
 * @returns {Promise<boolean>}
 */
async function followPlayer(controller, targetUsername) {
  const { page, persona } = controller;

  try {
    // Try to click on the player's name in the player list to follow
    const playerItem = await page.$(`text=${targetUsername}`);
    if (playerItem) {
      await humanClick(controller, playerItem);
      await randomDelay(200, 500);
      return true;
    }

    // Fallback: walk forward toward the general direction
    // (The tether system handles the actual following logic)
    return false;
  } catch {
    return false;
  }
}

/**
 * Look up a Roblox userId by username via the users API.
 *
 * @param {object} controller - Browser controller (needs auth cookies)
 * @param {string} username
 * @returns {Promise<number|null>} userId or null
 */
async function resolveUserId(controller, username) {
  const { page } = controller;
  try {
    const resp = await page.evaluate(async (uname) => {
      const r = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [uname], excludeBannedUsers: true }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.data && data.data.length > 0 ? data.data[0].id : null;
    }, username);
    return resp;
  } catch {
    return null;
  }
}

/**
 * Get the game (place) a user is currently playing via the Presence API.
 * Requires the bot to be authenticated (cookies set).
 *
 * @param {object} controller - Browser controller
 * @param {number} userId - Target user's Roblox userId
 * @returns {Promise<{placeId: number, gameId: string}|null>}
 */
async function getPlayerPresence(controller, userId) {
  const { page } = controller;
  try {
    const resp = await page.evaluate(async (uid) => {
      const r = await fetch('https://presence.roblox.com/v1/presence/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [uid] }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data.userPresences || data.userPresences.length === 0) return null;
      const p = data.userPresences[0];
      if (p.userPresenceType !== 2 || !p.placeId) return null;
      return { placeId: p.placeId, rootPlaceId: p.rootPlaceId, gameId: p.gameId };
    }, userId);
    return resp;
  } catch {
    return null;
  }
}

/**
 * Auto-join whatever game the owner is currently playing.
 * Resolves owner username → userId → presence → joinGame.
 *
 * @param {object} controller
 * @param {string} ownerUsername
 * @returns {Promise<boolean>}
 */
async function joinOwnerGame(controller, ownerUsername) {
  const { persona } = controller;
  console.log(`[Browser:${persona.username}] Looking up ${ownerUsername}'s game...`);

  const userId = await resolveUserId(controller, ownerUsername);
  if (!userId) {
    console.log(`[Browser:${persona.username}] Could not resolve userId for ${ownerUsername}`);
    return false;
  }

  const presence = await getPlayerPresence(controller, userId);
  if (!presence) {
    console.log(`[Browser:${persona.username}] ${ownerUsername} is not in a game right now`);
    return false;
  }

  const gameUrl = `https://www.roblox.com/games/${presence.rootPlaceId || presence.placeId}`;
  console.log(`[Browser:${persona.username}] ${ownerUsername} is playing ${gameUrl} — joining...`);
  return joinGame(controller, gameUrl);
}

module.exports = {
  createBrowserController,
  launch,
  login,
  createAccount,
  changeDisplayName,
  sendFriendRequest,
  joinGame,
  joinOwnerGame,
  resolveUserId,
  getPlayerPresence,
  sendChat,
  readChat,
  executeMovement,
  performEmote,
  followPlayer,
  isKicked,
  shutdown,
  SELECTORS,
};
