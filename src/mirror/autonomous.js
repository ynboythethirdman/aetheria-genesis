/**
 * Mirror — Autonomous Runner (Multi-Instance)
 *
 * Supports multiple concurrent pipelines (per-channel).
 * Each pipeline has its own state, keyword, and callbacks.
 * Auto-generates accounts when pool runs out.
 * 200 model cap per account (Roblox limit).
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');
const { recordSession, getRemainingUploads, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { notifyPipelineSummary } = require('./discord');

// ── Pipeline Instances ───────────────────────────────────────────────

const pipelines = new Map(); // channelId → PipelineState

class PipelineState {
  constructor(channelId, options = {}) {
    this.channelId = channelId;
    this.keyword = options.keyword || '';
    this.modelsPerCycle = options.modelsPerCycle || 50;
    this.threads = options.threads || 15;
    this.maxCycles = options.maxCycles || 0;
    this.running = false;
    this.cycle = 0;
    this.cycleCallback = null;
    this.alertCallback = null;
    this.startedAt = null;
    this.startedBy = options.startedBy || 'unknown';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function log(channelId, msg) {
  const tag = channelId ? channelId.slice(-4) : '----';
  console.log(`  \x1b[35m[Mirror:${tag}]\x1b[0m ${msg}`);
}

function emitAlert(pipeline, type, msg) {
  log(pipeline.channelId, `\x1b[31m[${type.toUpperCase()}]\x1b[0m ${msg}`);
  if (pipeline.alertCallback) pipeline.alertCallback(type, msg);
}

function getAvailableAccounts() {
  const accounts = loadAccounts();
  return accounts.filter((a) => {
    if (!a.cookie) return false;
    return getRemainingUploads(a.username) > 0;
  });
}

// ── Global Getters ───────────────────────────────────────────────────

function isRunning(channelId) {
  if (channelId) {
    const p = pipelines.get(channelId);
    return p ? p.running : false;
  }
  for (const p of pipelines.values()) {
    if (p.running) return true;
  }
  return false;
}

function getCurrentCycle(channelId) {
  if (channelId) {
    const p = pipelines.get(channelId);
    return p ? p.cycle : 0;
  }
  let total = 0;
  for (const p of pipelines.values()) total += p.cycle;
  return total;
}

function getRunningPipelines() {
  const running = [];
  for (const p of pipelines.values()) {
    if (p.running) running.push(p);
  }
  return running;
}

function setCycleCallback(channelId, cb) {
  const p = pipelines.get(channelId);
  if (p) p.cycleCallback = cb;
}

function setAlertCallback(channelId, cb) {
  const p = pipelines.get(channelId);
  if (p) p.alertCallback = cb;
}

// ── Cycle Logic ──────────────────────────────────────────────────────

async function runCycle(pipeline) {
  const startTime = Date.now();
  pipeline.cycle++;
  log(pipeline.channelId, `Cycle #${pipeline.cycle} starting...`);

  // Get or create accounts
  let available = getAvailableAccounts();

  if (available.length === 0) {
    log(pipeline.channelId, 'No accounts with capacity — generating new batch...');
    emitAlert(pipeline, 'accounts', 'All accounts at 200 cap. Generating 5 new accounts...');

    for (let i = 0; i < 5; i++) {
      try {
        const account = await generateOneAccount(i + 1);
        if (account && account.cookie) {
          log(pipeline.channelId, `Account ${account.username} created`);
        }
      } catch (err) {
        emitAlert(pipeline, 'error', `Account creation failed: ${err.message}`);
      }
    }

    available = getAvailableAccounts();
    if (available.length === 0) {
      emitAlert(pipeline, 'critical', 'Failed to create accounts. Check SMSPool balance and CAPTCHA credits.');
      return { error: 'no_accounts', cycle: pipeline.cycle };
    }
  }

  let totalCapacity = 0;
  for (const acc of available) totalCapacity += getRemainingUploads(acc.username);
  const modelTarget = Math.min(pipeline.modelsPerCycle, totalCapacity);

  log(pipeline.channelId, `${available.length} account(s), capacity: ${totalCapacity}, targeting ${modelTarget} models`);

  // Grab models
  log(pipeline.channelId, 'Grabbing models...');
  const a1Results = await runA1({
    keyword: pipeline.keyword || '',
    count: modelTarget,
    account: available[0],
  });

  if (!a1Results || a1Results.length === 0) {
    emitAlert(pipeline, 'warning', 'No models found for: ' + (pipeline.keyword || 'popular'));
    return { error: 'no_models', cycle: pipeline.cycle };
  }

  log(pipeline.channelId, `Grabbed ${a1Results.length} models`);

  // Generate titles
  log(pipeline.channelId, 'Generating titles...');
  const b1Results = await runB1(a1Results);
  const titled = b1Results.filter((r) => r.listing);
  log(pipeline.channelId, `${titled.length} titles generated`);

  // Upload with round-robin account rotation
  log(pipeline.channelId, 'Uploading...');
  const publishable = b1Results.filter((r) => r.listing && r.listing.modelPath);
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
      emitAlert(pipeline, 'accounts', 'All accounts at capacity');
      break;
    }
  }

  const allB2 = [];
  for (const [username, { account, models }] of accountChunks) {
    if (models.length === 0) continue;
    log(pipeline.channelId, `Uploading ${models.length} to ${username}`);
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
    cycle: pipeline.cycle,
    keyword: pipeline.keyword || 'popular',
    modelsDownloaded: a1Results.length,
    modelsTitled: titled.length,
    modelsPublished: totalPublished,
    modelsFailed: totalFailed,
    accountsUsed: accountChunks.size,
    duration,
    channelId: pipeline.channelId,
  };

  recordSession(summary);
  log(pipeline.channelId, `Cycle #${pipeline.cycle}: ${totalPublished} uploaded, ${totalFailed} failed (${duration})`);

  if (totalFailed > totalPublished && totalPublished + totalFailed > 0) {
    emitAlert(pipeline, 'warning', `High failure rate: ${totalFailed}/${totalPublished + totalFailed}`);
  }

  if (pipeline.cycleCallback) pipeline.cycleCallback(summary);
  return summary;
}

// ── Start / Stop ─────────────────────────────────────────────────────

async function startAutonomous(channelId, options = {}) {
  if (pipelines.has(channelId) && pipelines.get(channelId).running) {
    log(channelId, 'Already running in this channel');
    return;
  }

  const pipeline = new PipelineState(channelId, options);
  pipelines.set(channelId, pipeline);

  // Apply thread config
  if (pipeline.threads) {
    const config = require('./config');
    config.concurrency.uploads = pipeline.threads;
  }

  pipeline.running = true;
  pipeline.startedAt = Date.now();
  let consecutiveErrors = 0;

  log(channelId, 'Autonomous mode started');
  log(channelId, `Keyword: ${pipeline.keyword || 'popular'} | Models/cycle: ${pipeline.modelsPerCycle} | Threads: ${pipeline.threads}`);

  while (pipeline.running) {
    try {
      const result = await runCycle(pipeline);

      if (result.error === 'no_accounts') {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          emitAlert(pipeline, 'critical', 'Failed to create accounts 3x. Stopping.');
          break;
        }
        await sleep(pipeline, 60000);
        continue;
      }

      if (result.error === 'no_models') {
        await sleep(pipeline, 30000);
        continue;
      }

      consecutiveErrors = 0;
      await notifyPipelineSummary(result).catch(() => {});

      if (pipeline.maxCycles > 0 && pipeline.cycle >= pipeline.maxCycles) {
        log(channelId, `Reached max cycles (${pipeline.maxCycles}).`);
        break;
      }

      await sleep(pipeline, 10000);

    } catch (err) {
      consecutiveErrors++;
      emitAlert(pipeline, 'error', `Cycle error: ${err.message}`);
      if (consecutiveErrors >= 5) {
        emitAlert(pipeline, 'critical', 'Too many errors. Stopping.');
        break;
      }
      await sleep(pipeline, 30000);
    }
  }

  pipeline.running = false;
  log(channelId, `Stopped after ${pipeline.cycle} cycles`);
}

function stopAutonomous(channelId) {
  if (channelId) {
    const p = pipelines.get(channelId);
    if (!p || !p.running) return false;
    p.running = false;
    log(channelId, 'Stop requested — finishing current cycle...');
    return true;
  }
  // Stop all
  let stopped = false;
  for (const p of pipelines.values()) {
    if (p.running) {
      p.running = false;
      stopped = true;
    }
  }
  return stopped;
}

function sleep(pipeline, ms) {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (!pipeline.running) { clearInterval(check); resolve(); }
    }, 1000);
    setTimeout(() => { clearInterval(check); resolve(); }, ms);
  });
}

module.exports = {
  startAutonomous, stopAutonomous, isRunning, getCurrentCycle,
  setCycleCallback, setAlertCallback, getAvailableAccounts,
  getRunningPipelines, pipelines,
};
