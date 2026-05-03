/**
 * Mirror — OMO CAPTCHA Solver
 *
 * Solves Roblox FunCaptcha challenges via https://api.omocaptcha.com.
 * Reused from Vibe Squad with minimal changes.
 */

const config = require('../config');
const { sleep } = require('../utils/timing');

const API_BASE = config.captcha.apiBase;
const CLIENT_KEY = config.captcha.omoCaptchaKey;

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
    if (data.errorId === 0 && data.taskId) return data.taskId;

    console.error(`[CaptchaSolver] createTask failed: ${data.errorCode || 'unknown'}`);
    return null;
  } catch (err) {
    console.error(`[CaptchaSolver] createTask error: ${err.message}`);
    return null;
  }
}

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
      if (data.status === 'ready' && data.solution) return data.solution;

      await sleep(config.captcha.pollIntervalMs);
    } catch (err) {
      console.error(`[CaptchaSolver] poll error: ${err.message}`);
      return null;
    }
  }

  console.error('[CaptchaSolver] Timed out waiting for solution');
  return null;
}

async function solveFunCaptcha(page, tag) {
  if (!CLIENT_KEY) {
    console.log(`[CaptchaSolver:${tag}] No OMO_CAPTCHA_KEY set - skipping auto-solve`);
    return false;
  }

  console.log(`[CaptchaSolver:${tag}] Attempting auto-solve...`);

  try {
    const captchaFrame = await page.waitForSelector(
      'iframe[src*="funcaptcha"], iframe[src*="arkoselabs"], iframe[data-e2e="challenge-frame"]',
      { timeout: 10000 }
    ).catch(() => null);

    if (!captchaFrame) {
      console.log(`[CaptchaSolver:${tag}] No FunCaptcha iframe found`);
      return false;
    }

    const frame = await captchaFrame.contentFrame();
    if (!frame) return false;

    let challengeFrame = frame;
    const innerFrame = await frame.$('iframe[id="fc-iframe-wrap"], iframe[id*="CaptchaFrame"]');
    if (innerFrame) {
      const inner = await innerFrame.contentFrame();
      if (inner) challengeFrame = inner;
    }

    for (let round = 0; round < 6; round++) {
      await sleep(2000);

      const questionText = await challengeFrame.evaluate(() => {
        const el = document.querySelector(
          '#game_children_text h2, .challenge-instruction, [class*="instruction"], [class*="game_children"] h2'
        );
        return el ? el.textContent.trim() : '';
      }).catch(() => '');

      if (!questionText) {
        console.log(`[CaptchaSolver:${tag}] No question text (round ${round + 1}) - may be solved`);
        break;
      }

      const imageBase64 = await challengeFrame.evaluate(() => {
        const img = document.querySelector(
          '#game_challengeItem_image img, .challenge-image img, [class*="challenge"] img'
        );
        if (!img || !img.src) return null;
        if (img.src.startsWith('data:image')) return img.src.split(',')[1];
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      }).catch(() => null);

      if (!imageBase64) {
        console.log(`[CaptchaSolver:${tag}] Could not extract image (round ${round + 1})`);
        continue;
      }

      const taskId = await createTask(imageBase64, questionText);
      if (!taskId) continue;

      const solution = await getTaskResult(taskId);
      if (!solution) continue;

      const answerIndex = solution.index !== undefined ? solution.index : solution.answer;
      if (answerIndex === undefined) continue;

      const clicked = await challengeFrame.evaluate((idx) => {
        const images = document.querySelectorAll(
          '.answer-image, [class*="answer"] img, .fc-answer, .challenge-answer'
        );
        if (images[idx]) {
          images[idx].click();
          return true;
        }
        return false;
      }, answerIndex).catch(() => false);

      if (clicked) {
        console.log(`[CaptchaSolver:${tag}] Round ${round + 1} answered (index ${answerIndex})`);
        await sleep(2000);
      }
    }

    await sleep(3000);
    return true;
  } catch (err) {
    console.error(`[CaptchaSolver:${tag}] Error: ${err.message}`);
    return false;
  }
}

module.exports = { solveFunCaptcha };
