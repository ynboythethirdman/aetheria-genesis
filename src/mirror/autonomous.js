/**
 * Mirror — Autonomous Runner
 *
 * Runs the full pipeline indefinitely with account rotation.
 * Automatically generates new accounts when the pool runs out.
 * Each account has a 200-model upload cap (Roblox limit).
 *
 * Designed to run for days without human intervention.
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');
const { recordSession, getRemainingUploads, getAccountUploadCount, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { notifyPipelineSummary } = require('./discord');

let running = false;
let currentCycle = 0;
let statusCallback = null;
let alertCallback = null;

function isRunning() { return running; }
function getCurrentCycle() { return currentCycle; }
function setStatusCallback(cb) { statusCallback = cb; }
function setAlertCallback(cb) { alertCallback = cb; }

function emitStatus(msg) {
  console.log(`  [Auto] ${msg}`);
  if (statusCallback) statusCallback(msg);
}

function emitAlert(type, msg) {
  console.log(`  [ALERT] ${type}: ${msg}`);
  if (alertCallback) alertCallback(type, msg);
}

/**
 * Get accounts that still have upload capacity.
 */
function getAvailableAccounts() {
  const accounts = loadAccounts();
  return accounts.filter((a) => {
    if (!a.cookie) return false;
    const remaining = getRemainingUploads(a.username);
    return remaining > 0;
  });
}

/**
 * Run a single cycle: grab models → title → upload using available accounts.
 * Returns summary of the cycle.
 */
async function runCycle(keyword, modelsPerCycle) {
  const startTime = Date.now();
  currentCycle++;
  emitStatus(`Cycle #${currentCycle} starting...`);

  // ── Get or create accounts ─────────────────────────────────────────
  let available = getAvailableAccounts();

  if (available.length === 0) {
    emitStatus('No accounts available — generating new ones...');
    emitAlert('accounts', 'All accounts at 200 cap. Generating new accounts...');

    const newAccounts = [];
    for (let i = 0; i < 5; i++) {
      emitStatus(`Creating account ${i + 1}/5...`);
      try {
        const account = await generateOneAccount(i + 1);
        if (account && account.cookie) {
          newAccounts.push(account);
          emitStatus(`Account ${account.username} created`);
        }
      } catch (err) {
        emitAlert('error', `Account creation failed: ${err.message}`);
      }
    }

    if (newAccounts.length === 0) {
      emitAlert('critical', 'Failed to create any accounts. Check SMSPool balance and CAPTCHA credits.');
      return { error: 'no_accounts', cycle: currentCycle };
    }

    available = newAccounts.filter((a) => a.cookie);
  }

  // Calculate how many models we can upload across all available accounts
  let totalCapacity = 0;
  for (const acc of available) {
    totalCapacity += getRemainingUploads(acc.username);
  }

  const modelTarget = Math.min(modelsPerCycle || 50, totalCapacity);
  emitStatus(`${available.length} account(s), capacity: ${totalCapacity}, targeting ${modelTarget} models`);

  // ── Grab models ────────────────────────────────────────────────────
  emitStatus('Grabbing models...');
  const a1Results = await runA1({
    keyword: keyword || '',
    count: modelTarget,
    account: available[0],
  });

  if (!a1Results || a1Results.length === 0) {
    emitAlert('warning', 'No models found for keyword: ' + (keyword || '(popular)'));
    return { error: 'no_models', cycle: currentCycle };
  }

  emitStatus(`Grabbed ${a1Results.length} models`);

  // ── Generate titles ────────────────────────────────────────────────
  emitStatus('Generating titles...');
  const b1Results = await runB1(a1Results);
  const titled = b1Results.filter((r) => r.listing);
  emitStatus(`${titled.length} titles generated`);

  // ── Upload with account rotation ──────────────────────────────────
  emitStatus('Uploading with account rotation...');
  const publishable = b1Results.filter((r) => r.listing && r.listing.modelPath);

  // Distribute models across accounts respecting their remaining capacity
  const accountChunks = new Map();
  let accIdx = 0;

  for (const model of publishable) {
    // Find next account with capacity
    let tries = 0;
    while (tries < available.length) {
      const acc = available[accIdx % available.length];
      const remaining = getRemainingUploads(acc.username);
      if (remaining > 0) {
        if (!accountChunks.has(acc.username)) {
          accountChunks.set(acc.username, { account: acc, models: [] });
        }
        const chunk = accountChunks.get(acc.username);
        if (chunk.models.length < remaining) {
          chunk.models.push(model);
          break;
        }
      }
      accIdx++;
      tries++;
    }
    if (tries >= available.length) {
      emitAlert('accounts', 'All accounts at capacity during upload distribution');
      break;
    }
  }

  // Upload each account's chunk
  const allB2 = [];
  for (const [username, { account, models }] of accountChunks) {
    if (models.length === 0) continue;
    emitStatus(`Uploading ${models.length} to ${username} (${getRemainingUploads(username)} remaining)`);
    const b2Results = await runB2(models, account);
    allB2.push(...b2Results);
  }

  const elapsed = Date.now() - startTime;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const duration = `${mins}m ${secs}s`;

  const totalPublished = allB2.filter((r) => r.published?.success).length;
  const totalFailed = allB2.filter((r) => r.published && !r.published.success).length;

  const summary = {
    cycle: currentCycle,
    modelsDownloaded: a1Results.length,
    modelsTitled: titled.length,
    modelsPublished: totalPublished,
    modelsFailed: totalFailed,
    accountsUsed: accountChunks.size,
    duration,
  };

  recordSession(summary);
  emitStatus(`Cycle #${currentCycle} complete: ${totalPublished} uploaded, ${totalFailed} failed (${duration})`);

  // Check for issues to alert on
  if (totalFailed > totalPublished) {
    emitAlert('warning', `High failure rate: ${totalFailed}/${totalPublished + totalFailed} failed`);
  }

  return summary;
}

/**
 * Start the autonomous loop.
 * Runs until stopped or critical error.
 *
 * @param {object} options
 * @param {string} options.keyword - Model search keyword
 * @param {number} options.modelsPerCycle - Models to process per cycle (default 50)
 * @param {number} options.delayBetweenCycles - Delay in ms between cycles (default 30000)
 * @param {number} options.maxCycles - Max cycles before stopping (0 = infinite)
 */
async function startAutonomous(options = {}) {
  const {
    keyword = '',
    modelsPerCycle = 50,
    delayBetweenCycles = 30000,
    maxCycles = 0,
  } = options;

  if (running) {
    emitStatus('Already running');
    return;
  }

  running = true;
  currentCycle = 0;
  let consecutiveErrors = 0;

  emitStatus('Autonomous mode started');
  emitStatus(`Keyword: ${keyword || '(popular)'} | Models/cycle: ${modelsPerCycle} | Delay: ${delayBetweenCycles / 1000}s`);

  while (running) {
    try {
      const result = await runCycle(keyword, modelsPerCycle);

      if (result.error === 'no_accounts') {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          emitAlert('critical', 'Failed to create accounts 3 times in a row. Stopping.');
          break;
        }
        emitStatus(`Waiting 60s before retrying account creation...`);
        await sleep(60000);
        continue;
      }

      if (result.error === 'no_models') {
        emitStatus('No models found, waiting 30s...');
        await sleep(30000);
        continue;
      }

      consecutiveErrors = 0;

      // Send pipeline summary to Discord
      await notifyPipelineSummary(result).catch(() => {});

      if (maxCycles > 0 && currentCycle >= maxCycles) {
        emitStatus(`Reached max cycles (${maxCycles}). Stopping.`);
        break;
      }

      emitStatus(`Waiting ${delayBetweenCycles / 1000}s before next cycle...`);
      await sleep(delayBetweenCycles);

    } catch (err) {
      consecutiveErrors++;
      emitAlert('error', `Cycle error: ${err.message}`);

      if (consecutiveErrors >= 5) {
        emitAlert('critical', 'Too many consecutive errors. Stopping autonomous mode.');
        break;
      }

      emitStatus('Waiting 30s before retry...');
      await sleep(30000);
    }
  }

  running = false;
  emitStatus(`Autonomous mode stopped after ${currentCycle} cycles`);
}

function stopAutonomous() {
  if (!running) return false;
  running = false;
  emitStatus('Stop requested — finishing current cycle...');
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, ms);
  });
}

module.exports = {
  startAutonomous,
  stopAutonomous,
  isRunning,
  getCurrentCycle,
  setStatusCallback,
  setAlertCallback,
  getAvailableAccounts,
};
