/**
 * Mirror — Browser Automation (C1)
 *
 * Playwright-based Roblox account creation, settings navigation,
 * and verification flow. Adapted from Vibe Squad.
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const config = require('../config');
const { sleep, randomDelay, randomBetween, chance } = require('../utils/timing');
const { getRandomViewport, getRandomUserAgent, getRandomTimezone, addMouseNoise, generateMousePath, getKeystrokeDelays } = require('./stealth');
const { solveFunCaptcha } = require('./captchaSolver');

const SELECTORS = {
  // Signup
  birthdayMonth: 'select[name="birthdayMonth"]',
  birthdayDay: 'select[name="birthdayDay"]',
  birthdayYear: 'select[name="birthdayYear"]',
  signupUsername: 'input[name="signupUsername"]',
  signupPassword: 'input[name="signupPassword"]',
  signupSubmit: 'button[name="signupSubmit"]',
  genderMale: 'button[title="Male"]',
  genderFemale: 'button[title="Female"]',

  // Cookie / popup dismiss
  cookieAccept: '[class*="cookie"] button, [data-testid="cookie-accept"]',
  modalClose: '[class*="modal"] [class*="close"], .modal-close, button[aria-label="Close"]',

  // Settings
  settingsEmailInput: 'input[id*="email"], input[name*="email"], input[type="email"]',
  settingsPhoneInput: 'input[id*="phone"], input[name*="phone"], input[type="tel"]',
  settingsVerifyBtn: 'button:has-text("Verify"), button:has-text("Add"), button:has-text("Send")',
  settingsCodeInput: 'input[id*="code"], input[name*="code"], input[id*="verification"], input[placeholder*="code"], input[placeholder*="Code"]',
  settingsSubmitCode: 'button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm")',
  settingsSaveBtn: 'button:has-text("Save"), button[type="submit"]',

  // Error
  signupError: '.alert-warning, .signup-error-message, #GeneralErrorText',
};

/**
 * Create a controller object for a single browser session.
 */
function createController(tag) {
  return {
    tag,
    browser: null,
    context: null,
    page: null,
    viewport: getRandomViewport(),
    mousePosition: { x: 0, y: 0 },
  };
}

/**
 * Launch browser with stealth settings.
 */
async function launch(ctrl) {
  ctrl.browser = await chromium.launch({
    headless: config.browser.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      `--window-size=${ctrl.viewport.width},${ctrl.viewport.height}`,
    ],
  });

  ctrl.context = await ctrl.browser.newContext({
    viewport: ctrl.viewport,
    userAgent: getRandomUserAgent(),
    locale: 'en-US',
    timezoneId: getRandomTimezone(),
    javaScriptEnabled: true,
  });

  ctrl.page = await ctrl.context.newPage();
  console.log(`[Browser:${ctrl.tag}] Launched (${ctrl.viewport.width}x${ctrl.viewport.height})`);
}

/**
 * Dismiss cookie banners and modals.
 */
async function dismissPopups(page) {
  try {
    const cookieBtn = await page.$(SELECTORS.cookieAccept);
    if (cookieBtn) { await cookieBtn.click(); await randomDelay(500, 1000); }
    const closeBtn = await page.$(SELECTORS.modalClose);
    if (closeBtn) { await closeBtn.click(); await randomDelay(300, 800); }
  } catch { /* popups are optional */ }
}

/**
 * Type text with human-like keystroke delays.
 */
async function humanType(ctrl, element, text) {
  await element.click();
  await randomDelay(100, 300);
  const delays = getKeystrokeDelays(text);
  for (let i = 0; i < text.length; i++) {
    await element.type(text[i], { delay: 0 });
    await sleep(delays[i]);
  }
}

/**
 * Click an element with natural mouse movement.
 */
async function humanClick(ctrl, element) {
  const box = await element.boundingBox();
  if (!box) { await element.click(); return; }

  const target = addMouseNoise(box.x + box.width / 2, box.y + box.height / 2);
  const path = generateMousePath(ctrl.mousePosition.x, ctrl.mousePosition.y, target.x, target.y);

  for (const point of path) {
    await ctrl.page.mouse.move(point.x, point.y);
    await sleep(randomBetween(5, 20));
  }

  await ctrl.page.mouse.click(target.x, target.y);
  ctrl.mousePosition = target;
}

/**
 * Create a Roblox account via the signup page.
 * Retries with a new username up to 5 times if the name is taken.
 *
 * @param {object} ctrl - Browser controller
 * @param {object} info - { username, password, birthMonth, birthDay, birthYear }
 * @returns {Promise<{ success: boolean, username: string }>}
 */
async function createAccount(ctrl, info) {
  const { page, tag } = ctrl;
  const { generateUsername } = require('../utils/names');
  const MAX_USERNAME_RETRIES = 5;
  let currentUsername = info.username;

  for (let attempt = 1; attempt <= MAX_USERNAME_RETRIES; attempt++) {
    try {
      await page.goto('https://www.roblox.com/', { waitUntil: 'networkidle', timeout: 30000 });
      await randomDelay(2000, 4000);
      await dismissPopups(page);

      // Birthday
      const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthSel = await page.$(SELECTORS.birthdayMonth);
      if (monthSel) { await monthSel.selectOption(MONTHS[info.birthMonth || 6]); await randomDelay(300, 600); }

      const daySel = await page.$(SELECTORS.birthdayDay);
      if (daySel) { await daySel.selectOption(String(info.birthDay || 15).padStart(2, '0')); await randomDelay(300, 600); }

      const yearSel = await page.$(SELECTORS.birthdayYear);
      if (yearSel) { await yearSel.selectOption(String(info.birthYear || config.account.birthYear)); await randomDelay(500, 1000); }

      // Username
      const userInput = await page.$(SELECTORS.signupUsername);
      if (userInput) {
        await userInput.click({ clickCount: 3 });
        await randomDelay(100, 200);
        await humanType(ctrl, userInput, currentUsername);
        await randomDelay(1000, 2000);
      }

      // Check for username error before submitting
      const usernameError = await page.$('.form-has-error .form-control-label, .username-error, [id*="UsernameError"]');
      if (usernameError) {
        const errText = await usernameError.textContent().catch(() => '');
        if (errText && (errText.toLowerCase().includes('taken') || errText.toLowerCase().includes('not available') || errText.toLowerCase().includes('already in use'))) {
          const oldName = currentUsername;
          currentUsername = generateUsername();
          console.log(`[Mirror:${tag}] Username "${oldName}" is taken — trying "${currentUsername}" (attempt ${attempt}/${MAX_USERNAME_RETRIES})`);
          continue;
        }
      }

      // Password
      const passInput = await page.$(SELECTORS.signupPassword);
      if (passInput) { await humanType(ctrl, passInput, info.password); await randomDelay(500, 1000); }

      // Gender (random)
      if (chance(0.5)) {
        const maleBtn = await page.$(SELECTORS.genderMale);
        if (maleBtn) await humanClick(ctrl, maleBtn);
      } else {
        const femaleBtn = await page.$(SELECTORS.genderFemale);
        if (femaleBtn) await humanClick(ctrl, femaleBtn);
      }
      await randomDelay(300, 600);

      // Submit
      const signupBtn = await page.$(SELECTORS.signupSubmit);
      if (signupBtn) {
        for (let w = 0; w < 20; w++) {
          const disabled = await signupBtn.evaluate((el) => el.disabled);
          if (!disabled) break;
          await sleep(500);
        }
        await humanClick(ctrl, signupBtn);
        console.log(`[Mirror:${tag}] Signup submitted for ${currentUsername}`);
      }

      // Wait briefly for error or CAPTCHA
      await sleep(2000);

      // Check for username-taken error after submit
      const postError = await page.$(SELECTORS.signupError);
      if (postError) {
        const errorText = await postError.textContent().catch(() => '');
        if (errorText && (errorText.toLowerCase().includes('taken') || errorText.toLowerCase().includes('not available') || errorText.toLowerCase().includes('already in use') || errorText.toLowerCase().includes('username'))) {
          const oldName = currentUsername;
          currentUsername = generateUsername();
          console.log(`[Mirror:${tag}] Username "${oldName}" is taken — trying "${currentUsername}" (attempt ${attempt}/${MAX_USERNAME_RETRIES})`);
          continue;
        }
      }

      // Handle CAPTCHA
      console.log(`[Mirror:${tag}] Waiting for CAPTCHA or redirect...`);
      const captchaFrame = await page.waitForSelector(
        'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="captcha"]',
        { timeout: 30000 }
      ).catch(() => null);

      if (captchaFrame) {
        console.log(`[Mirror:${tag}] CAPTCHA detected - attempting auto-solve...`);
        await sleep(15000);
        const solved = await solveFunCaptcha(page, tag);
        if (solved) {
          await page.waitForURL(/\/(home|discover)/, { timeout: 30000 }).catch(() => {});
        } else {
          console.log(`[Mirror:${tag}] Auto-solve failed - waiting for manual solve...`);
          await page.waitForURL(/\/(home|discover)/, { timeout: 120000 }).catch(() => {
            console.log(`[Mirror:${tag}] CAPTCHA timeout`);
          });
        }
      }

      const currentUrl = page.url();
      if (currentUrl.includes('/home') || currentUrl.includes('/discover')) {
        console.log(`[Mirror:${tag}] Account created: ${currentUsername}`);
        info.username = currentUsername;
        return true;
      }

      // Generic error — don't retry for non-username errors
      const errorEl = await page.$(SELECTORS.signupError);
      if (errorEl) {
        const errorText = await errorEl.textContent();
        if (errorText.trim()) console.log(`[Mirror:${tag}] Signup error: ${errorText.trim()}`);
      }
      return false;
    } catch (err) {
      console.error(`[Mirror:${tag}] Account creation error: ${err.message}`);
      return false;
    }
  }

  console.log(`[Mirror:${tag}] Failed after ${MAX_USERNAME_RETRIES} username attempts`);
  return false;
}

/**
 * Navigate to Roblox account settings page.
 */
async function goToSettings(ctrl) {
  const { page, tag } = ctrl;
  try {
    await page.goto('https://www.roblox.com/my/account#!/info', {
      waitUntil: 'networkidle',
      timeout: 20000,
    });
    await randomDelay(2000, 3000);
    console.log(`[Mirror:${tag}] On settings page`);
    return true;
  } catch (err) {
    console.error(`[Mirror:${tag}] Failed to navigate to settings: ${err.message}`);
    return false;
  }
}

/**
 * Add and verify an email address in the settings page.
 *
 * @param {object} ctrl - Browser controller
 * @param {string} email - The email address to add
 * @returns {Promise<boolean>} Whether the email field was submitted
 */
async function addEmailInSettings(ctrl, email) {
  const { page, tag } = ctrl;
  try {
    // Look for the email section — Roblox settings has an "Add Email" or email input
    const emailLink = await page.$('a:has-text("Add Email"), button:has-text("Add Email"), a:has-text("email"), span:has-text("Email Address")');
    if (emailLink) {
      await humanClick(ctrl, emailLink);
      await randomDelay(1000, 2000);
    }

    const emailInput = await page.waitForSelector(SELECTORS.settingsEmailInput, { timeout: 10000 }).catch(() => null);
    if (!emailInput) {
      console.log(`[Mirror:${tag}] Email input not found on settings page`);
      return false;
    }

    await humanType(ctrl, emailInput, email);
    await randomDelay(500, 1000);

    // Click the add/verify/send button
    const verifyBtn = await page.$('button:has-text("Add Email"), button:has-text("Verify"), button:has-text("Send"), button:has-text("Save")');
    if (verifyBtn) {
      await humanClick(ctrl, verifyBtn);
      await randomDelay(2000, 3000);
      console.log(`[Mirror:${tag}] Email submitted: ${email}`);
      return true;
    }

    console.log(`[Mirror:${tag}] No verify/send button found for email`);
    return false;
  } catch (err) {
    console.error(`[Mirror:${tag}] Add email error: ${err.message}`);
    return false;
  }
}

/**
 * Enter the verification code received via email.
 */
async function enterEmailCode(ctrl, code) {
  const { page, tag } = ctrl;
  try {
    const codeInput = await page.waitForSelector(SELECTORS.settingsCodeInput, { timeout: 15000 }).catch(() => null);
    if (!codeInput) {
      console.log(`[Mirror:${tag}] Verification code input not found`);
      return false;
    }

    await humanType(ctrl, codeInput, code);
    await randomDelay(500, 1000);

    const submitBtn = await page.$(SELECTORS.settingsSubmitCode);
    if (submitBtn) {
      await humanClick(ctrl, submitBtn);
      await randomDelay(2000, 3000);
      console.log(`[Mirror:${tag}] Email verification code submitted`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Mirror:${tag}] Enter email code error: ${err.message}`);
    return false;
  }
}

/**
 * Add a phone number in settings and click send/verify.
 */
async function addPhoneInSettings(ctrl, phoneNumber) {
  const { page, tag } = ctrl;
  try {
    // Navigate to security or phone section
    const phoneLink = await page.$('a:has-text("Add Phone"), button:has-text("Add Phone"), a:has-text("phone"), span:has-text("Phone Number")');
    if (phoneLink) {
      await humanClick(ctrl, phoneLink);
      await randomDelay(1000, 2000);
    }

    const phoneInput = await page.waitForSelector(SELECTORS.settingsPhoneInput, { timeout: 10000 }).catch(() => null);
    if (!phoneInput) {
      console.log(`[Mirror:${tag}] Phone input not found`);
      return false;
    }

    await humanType(ctrl, phoneInput, phoneNumber);
    await randomDelay(500, 1000);

    const verifyBtn = await page.$('button:has-text("Add Phone"), button:has-text("Verify"), button:has-text("Send"), button:has-text("Continue")');
    if (verifyBtn) {
      await humanClick(ctrl, verifyBtn);
      await randomDelay(2000, 3000);
      console.log(`[Mirror:${tag}] Phone submitted: ${phoneNumber}`);
      return true;
    }

    console.log(`[Mirror:${tag}] No verify button found for phone`);
    return false;
  } catch (err) {
    console.error(`[Mirror:${tag}] Add phone error: ${err.message}`);
    return false;
  }
}

/**
 * Enter SMS verification code for phone.
 */
async function enterPhoneCode(ctrl, code) {
  const { page, tag } = ctrl;
  try {
    const codeInput = await page.waitForSelector(SELECTORS.settingsCodeInput, { timeout: 15000 }).catch(() => null);
    if (!codeInput) {
      console.log(`[Mirror:${tag}] Phone code input not found`);
      return false;
    }

    await humanType(ctrl, codeInput, code);
    await randomDelay(500, 1000);

    const submitBtn = await page.$(SELECTORS.settingsSubmitCode);
    if (submitBtn) {
      await humanClick(ctrl, submitBtn);
      await randomDelay(2000, 3000);
      console.log(`[Mirror:${tag}] Phone verification code submitted`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[Mirror:${tag}] Enter phone code error: ${err.message}`);
    return false;
  }
}

/**
 * Close the browser.
 */
async function shutdown(ctrl) {
  try {
    if (ctrl.page) await ctrl.page.close().catch(() => {});
    if (ctrl.context) await ctrl.context.close().catch(() => {});
    if (ctrl.browser) await ctrl.browser.close().catch(() => {});
    console.log(`[Browser:${ctrl.tag}] Shutdown`);
  } catch (err) {
    console.error(`[Browser:${ctrl.tag}] Shutdown error: ${err.message}`);
  }
}

module.exports = {
  createController,
  launch,
  dismissPopups,
  humanType,
  humanClick,
  createAccount,
  goToSettings,
  addEmailInSettings,
  enterEmailCode,
  addPhoneInSettings,
  enterPhoneCode,
  shutdown,
  SELECTORS,
};
