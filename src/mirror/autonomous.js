/**
 * Mirror — Autonomous Runner
 *
 * Runs the full pipeline indefinitely with account rotation.
 * Auto-generates accounts when pool runs out.
 * 200 model cap per account (Roblox limit).
 *
 * Designed to run for days without human intervention.
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');
const { recordSession, getRemainingUploads, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { notifyPipelineSummary } = require('./discord');

let running = false;
let currentCycle = 0;
let cycleCallback = null;
let alertCallback = null;

function isRunning() { return running; }
function getCurrentCycle() { return currentCycle; }
function setCycleCallback(cb) { cycleCallback = cb; }
function setAlertCallback(cb) { alertCallback = cb; }

function log(msg) {
  console.log(`  \x1b[35m[Mirror]\x1b[0m ${msg}`);
}

function emitAlert(type, msg) {
  log(`\x1b[31m[${type.toUpperCase()}]\x1b[0m ${msg}`);
  if (alertCallback) alertCallback(type, msg);
}

function getAvailableAccounts() {
  const accounts = loadAccounts();
  return accounts.filter((a) => {
    if (!a.cookie) return false;
    return getRemainingUploads(a.username) > 0;
  });
}

/**
 * Run a single cycle: grab → title → upload.
 */
async function runCycle(keyword, modelsPerCycle) {
  const startTime = Date.now();
  currentCycle++;
  log(`Cycle #${currentCycle} starting...`);

  // ── Get or create accounts ─────────────────────────────────────────
  let available = getAvailableAccounts();

  if (available.length === 0) {
    log('No accounts with capacity — generating new batch...');
    emitAlert('accounts', 'All accounts at 200 cap. Generating 5 new accounts...');

    for (let i = 0; i < 5; i++) {
      try {
        const account = await generateOneAccount(i + 1);
        if (account && account.cookie) {
          log(`Account ${account.username} created`);
        }
      } catch (err) {
        emitAlert('error', `Account creation failed: ${err.message}`);
      }
    }

    available = getAvailableAccounts();
    if (available.length === 0) {
      emitAlert('critical', 'Failed to create accounts. Check SMSPool balance and CAPTCHA credits.');
      return { error: 'no_accounts', cycle: currentCycle };
    }
  }

  // Calculate capacity
  let totalCapacity = 0;
  for (const acc of available) totalCapacity += getRemainingUploads(acc.username);
  const modelTarget = Math.min(modelsPerCycle || 50, totalCapacity);

  log(`${available.length} account(s), capacity: ${totalCapacity}, targeting ${modelTarget} models`);

  // ── Grab models ────────────────────────────────────────────────────
  log('Grabbing models...');
  const a1Results = await runA1({
    keyword: keyword || '',
    count: modelTarget,
    account: available[0],
  });

  if (!a1Results || a1Results.length === 0) {
    emitAlert('warning', 'No models found for: ' + (keyword || 'popular'));
    return { error: 'no_models', cycle: currentCycle };
  }

  log(`Grabbed ${a1Results.length} models`);

  // ── Generate titles ────────────────────────────────────────────────
  log('Generating titles...');
  const b1Results = await runB1(a1Results);
  const titled = b1Results.filter((r) => r.listing);
  log(`${titled.length} titles generated`);

  // ── Upload with account rotation ──────────────────────────────────
  log('Uploading...');
  const publishable = b1Results.filter((r) => r.listing && r.listing.modelPath);

  // Distribute round-robin respecting capacity
  const accountChunks = new Map();
  let accIdx = 0;

  for (const model of publishable) {
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
      emitAlert('accounts', 'All accounts at capacity');
      break;
    }
  }

  const allB2 = [];
  for (const [username, { account, models }] of accountChunks) {
    if (models.length === 0) continue;
    log(`Uploading ${models.length} to ${username}`);
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
  log(`Cycle #${currentCycle}: ${totalPublished} uploaded, ${totalFailed} failed (${duration})`);

  if (totalFailed > totalPublished && totalPublished + totalFailed > 0) {
    emitAlert('warning', `High failure rate: ${totalFailed}/${totalPublished + totalFailed}`);
  }

  // Send ONE clean cycle summary to Discord (no spam)
  if (cycleCallback) cycleCallback(summary);

  return summary;
}

/**
 * Start autonomous loop.
 */
async function startAutonomous(options = {}) {
  const {
    keyword = '',
    modelsPerCycle = 50,
    threads = 15,
    maxCycles = 0,
  } = options;

  if (running) {
    log('Already running');
    return;
  }

  // Apply thread config
  if (threads) {
    const config = require('./config');
    config.concurrency.uploads = threads;
  }

  running = true;
  currentCycle = 0;
  let consecutiveErrors = 0;

  log('Autonomous mode started');
  log(`Keyword: ${keyword || 'popular'} | Models/cycle: ${modelsPerCycle} | Threads: ${threads}`);

  while (running) {
    try {
      const result = await runCycle(keyword, modelsPerCycle);

      if (result.error === 'no_accounts') {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          emitAlert('critical', 'Failed to create accounts 3x. Stopping.');
          break;
        }
        await sleep(60000);
        continue;
      }

      if (result.error === 'no_models') {
        await sleep(30000);
        continue;
      }

      consecutiveErrors = 0;
      await notifyPipelineSummary(result).catch(() => {});

      if (maxCycles > 0 && currentCycle >= maxCycles) {
        log(`Reached max cycles (${maxCycles}).`);
        break;
      }

      // Brief pause between cycles
      await sleep(10000);

    } catch (err) {
      consecutiveErrors++;
      emitAlert('error', `Cycle error: ${err.message}`);
      if (consecutiveErrors >= 5) {
        emitAlert('critical', 'Too many errors. Stopping.');
        break;
      }
      await sleep(30000);
    }
  }

  running = false;
  log(`Stopped after ${currentCycle} cycles`);
}

function stopAutonomous() {
  if (!running) return false;
  running = false;
  log('Stop requested — finishing current cycle...');
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (!running) { clearInterval(check); resolve(); }
    }, 1000);
    setTimeout(() => { clearInterval(check); resolve(); }, ms);
  });
}

module.exports = {
  startAutonomous, stopAutonomous, isRunning, getCurrentCycle,
  setCycleCallback, setAlertCallback, getAvailableAccounts,
};
