/**
 * Vibe Squad — OMO CAPTCHA Solver
 *
 * Integrates with https://api.omocaptcha.com to solve Roblox FunCaptcha
 * challenges during signup. Uses the FuncaptchaImageTask endpoint:
 *   1. Extract captcha image + question from the FunCaptcha iframe
 *   2. POST image to createTask
 *   3. Poll getTaskResult until solved
 *   4. Click the correct answer in the browser
 */

const config = require('../config');
const { sleep } = require('../utils/timing');

const API_BASE = config.captcha.apiBase;
const CLIENT_KEY = config.captcha.omoCaptchaKey;

/**
 * Submit a FunCaptcha image to OMO for solving.
 *
 * @param {string} imageBase64 - The captcha image encoded as base64
 * @param {string} questionText - The instruction/question text
 * @returns {Promise<string|null>} taskId or null on failure
 */
async function createTask(imageBase64, questionText) {
  try {
    const resp = await fetch(`${API_BASE}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: CLIENT_KEY,
        task: {
          type: 'FuncaptchaImageTask',
          imageBase64,
          other: questionText,
        },
      }),
    });

    const data = await resp.json();
    if (data.errorId === 0 && data.taskId) {
      return data.taskId;
    }

    console.error(`[CaptchaSolver] createTask failed: ${data.errorCode || 'unknown'}`);
    return null;
  } catch (err) {
    console.error(`[CaptchaSolver] createTask error: ${err.message}`);
    return null;
  }
}

/**
 * Poll for a task result until solved or timeout.
 *
 * @param {string} taskId
 * @returns {Promise<{index: number}|null>} Solution or null
 */
async function getTaskResult(taskId) {
  for (let i = 0; i < config.captcha.maxPollAttempts; i++) {
    try {
      const resp = await fetch(`${API_BASE}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: CLIENT_KEY, taskId }),
      });

      const data = await resp.json();

      if (data.errorId !== 0) {
        console.error(`[CaptchaSolver] getTaskResult error: ${data.errorCode}`);
        return null;
      }

      if (data.status === 'ready' && data.solution) {
        return data.solution;
      }

      // Still processing
      await sleep(config.captcha.pollIntervalMs);
    } catch (err) {
      console.error(`[CaptchaSolver] poll error: ${err.message}`);
      return null;
    }
  }

  console.error('[CaptchaSolver] Timed out waiting for solution');
  return null;
}

/**
 * Attempt to solve a FunCaptcha challenge in the browser.
 * Looks for the captcha iframe, extracts images, sends to OMO,
 * and clicks the correct answer.
 *
 * @param {object} controller - Browser controller with page
 * @returns {Promise<boolean>} Whether the captcha was solved
 */
async function solveFunCaptcha(controller) {
  const { page, persona } = controller;

  if (!CLIENT_KEY) {
    console.log(`[CaptchaSolver:${persona.username}] No OMO_CAPTCHA_KEY set — waiting for manual solve`);
    return false;
  }

  console.log(`[CaptchaSolver:${persona.username}] Attempting auto-solve...`);

  try {
    // Wait for the FunCaptcha iframe to appear
    const captchaFrame = await page.waitForSelector(
      'iframe[src*="funcaptcha"], iframe[src*="arkoselabs"], iframe[data-e2e="challenge-frame"]',
      { timeout: 10000 }
    ).catch(() => null);

    if (!captchaFrame) {
      console.log(`[CaptchaSolver:${persona.username}] No FunCaptcha iframe found`);
      return false;
    }

    // Get the content frame
    const frame = await captchaFrame.contentFrame();
    if (!frame) {
      console.log(`[CaptchaSolver:${persona.username}] Could not access captcha frame`);
      return false;
    }

    // FunCaptcha may have an inner iframe (enforcement frame)
    let challengeFrame = frame;
    const innerFrame = await frame.$('iframe[id="fc-iframe-wrap"], iframe[id*="CaptchaFrame"]');
    if (innerFrame) {
      const inner = await innerFrame.contentFrame();
      if (inner) challengeFrame = inner;
    }

    // Solve up to 6 rounds (FunCaptcha typically has 3-6 rounds)
    for (let round = 0; round < 6; round++) {
      await sleep(2000);

      // Extract the question/instruction text
      const questionText = await challengeFrame.evaluate(() => {
        const el = document.querySelector(
          '#game_children_text h2, .challenge-instruction, [class*="instruction"], [class*="game_children"] h2'
        );
        return el ? el.textContent.trim() : '';
      }).catch(() => '');

      if (!questionText) {
        // Might be done or no challenge visible
        console.log(`[CaptchaSolver:${persona.username}] No question text found (round ${round + 1}) — may be solved`);
        break;
      }

      // Extract the captcha image as base64
      const imageBase64 = await challengeFrame.evaluate(() => {
        const img = document.querySelector(
          '#game_challengeItem_image img, .challenge-image img, [class*="game_challengeItem"] img'
        );
        if (!img) return null;

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      }).catch(() => null);

      if (!imageBase64) {
        console.log(`[CaptchaSolver:${persona.username}] Could not extract captcha image (round ${round + 1})`);
        break;
      }

      console.log(`[CaptchaSolver:${persona.username}] Round ${round + 1}: "${questionText.substring(0, 60)}..."`);

      // Send to OMO API
      const taskId = await createTask(imageBase64, questionText);
      if (!taskId) {
        console.log(`[CaptchaSolver:${persona.username}] Failed to create task`);
        return false;
      }

      const solution = await getTaskResult(taskId);
      if (!solution) {
        console.log(`[CaptchaSolver:${persona.username}] No solution received`);
        return false;
      }

      console.log(`[CaptchaSolver:${persona.username}] Solution: index=${solution.index}`);

      // Click the right arrow (index - 1) times to select the correct answer
      // OMO returns the 1-based position, so click (index - 1) times
      const clickCount = Math.max(0, solution.index - 1);
      const rightArrow = await challengeFrame.$(
        'a[aria-label="Next challenge"], button[aria-label="Next challenge"], .right-arrow, [class*="arrow-right"], a.button'
      );

      if (rightArrow && clickCount > 0) {
        for (let c = 0; c < clickCount; c++) {
          await rightArrow.click();
          await sleep(500);
        }
      }

      // Click the submit/verify button
      const submitBtn = await challengeFrame.$(
        'a[aria-label="Submit"], button[type="submit"], .submit-button, a.button.verify, [class*="submit"]'
      );
      if (submitBtn) {
        await submitBtn.click();
        await sleep(2000);
      }

      // Check if the challenge is done
      const done = await challengeFrame.evaluate(() => {
        const successEl = document.querySelector('.success, [class*="success"], [class*="solved"]');
        return !!successEl;
      }).catch(() => false);

      if (done) {
        console.log(`[CaptchaSolver:${persona.username}] CAPTCHA solved after ${round + 1} round(s)`);
        return true;
      }
    }

    // Wait a bit to see if the page redirects (indicating success)
    await sleep(3000);
    const currentUrl = page.url();
    if (currentUrl.includes('/home') || currentUrl.includes('/discover')) {
      console.log(`[CaptchaSolver:${persona.username}] CAPTCHA solved — redirected to home`);
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[CaptchaSolver:${persona.username}] Error: ${err.message}`);
    return false;
  }
}

module.exports = { solveFunCaptcha, createTask, getTaskResult };
