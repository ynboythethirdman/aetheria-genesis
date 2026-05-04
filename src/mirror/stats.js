/**
 * Mirror — Stats Tracker
 *
 * Tracks upload history, account stats, and model counts.
 * Persists to data/mirror_stats.json.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATS_FILE = path.resolve(process.cwd(), config.output.statsFile);

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {
    totalAccountsCreated: 0,
    totalModelsDownloaded: 0,
    totalModelsUploaded: 0,
    totalModelsFailed: 0,
    accountUploads: {},
    uploads: [],
    sessions: [],
  };
}

function saveStats(stats) {
  const dir = path.dirname(STATS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function recordUpload(modelTitle, assetId, accountUsername, success) {
  const stats = loadStats();
  if (success) {
    stats.totalModelsUploaded++;
  } else {
    stats.totalModelsFailed++;
  }
  // Track per-account uploads (for 200 cap rotation)
  if (!stats.accountUploads) stats.accountUploads = {};
  if (!stats.accountUploads[accountUsername]) stats.accountUploads[accountUsername] = 0;
  if (success) stats.accountUploads[accountUsername]++;

  stats.uploads.push({
    title: modelTitle,
    assetId: assetId || null,
    account: accountUsername,
    success,
    timestamp: new Date().toISOString(),
  });
  if (stats.uploads.length > 500) {
    stats.uploads = stats.uploads.slice(-500);
  }
  saveStats(stats);
}

const MODEL_CAP_PER_ACCOUNT = 200;

function getAccountUploadCount(username) {
  const stats = loadStats();
  return (stats.accountUploads && stats.accountUploads[username]) || 0;
}

function getAccountsAtCap() {
  const stats = loadStats();
  const atCap = [];
  for (const [username, count] of Object.entries(stats.accountUploads || {})) {
    if (count >= MODEL_CAP_PER_ACCOUNT) atCap.push(username);
  }
  return atCap;
}

function getRemainingUploads(username) {
  return MODEL_CAP_PER_ACCOUNT - getAccountUploadCount(username);
}

function recordAccountCreated() {
  const stats = loadStats();
  stats.totalAccountsCreated++;
  saveStats(stats);
}

function recordModelsDownloaded(count) {
  const stats = loadStats();
  stats.totalModelsDownloaded += count;
  saveStats(stats);
}

function recordSession(summary) {
  const stats = loadStats();
  stats.sessions.push({
    ...summary,
    timestamp: new Date().toISOString(),
  });
  if (stats.sessions.length > 50) {
    stats.sessions = stats.sessions.slice(-50);
  }
  saveStats(stats);
}

/**
 * Print a clean stats dashboard to the console.
 */
function printDashboard(accounts) {
  const stats = loadStats();

  console.log('');
  console.log('  \x1b[35m┌──────────────────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m               \x1b[1m\x1b[35mMIRROR DASHBOARD\x1b[0m                      \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────────────────┘\x1b[0m');
  console.log('');

  // ── Overview ──
  console.log('  \x1b[36m  Overview\x1b[0m');
  console.log(`    Accounts Created    \x1b[33m${stats.totalAccountsCreated}\x1b[0m`);
  console.log(`    Models Downloaded   \x1b[33m${stats.totalModelsDownloaded}\x1b[0m`);
  console.log(`    Models Uploaded     \x1b[32m${stats.totalModelsUploaded}\x1b[0m`);
  console.log(`    Upload Failures     \x1b[31m${stats.totalModelsFailed}\x1b[0m`);
  console.log('');

  // ── Accounts ──
  if (accounts && accounts.length > 0) {
    console.log('  \x1b[36m  Accounts\x1b[0m');
    console.log('');
    console.log('  \x1b[90m  #   Username              Status           Cookie\x1b[0m');
    console.log('  \x1b[90m  ─── ──────────────────── ──────────────── ──────\x1b[0m');

    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      const user = (a.username || '').padEnd(20, ' ');
      const status = (a.status || 'unknown').padEnd(16, ' ');
      const cookie = a.cookie ? '\x1b[32mYes\x1b[0m   ' : '\x1b[31mNo\x1b[0m    ';
      console.log(`  \x1b[90m  ${String(i + 1).padStart(3, ' ')}\x1b[0m ${user} ${status} ${cookie}`);
    }
    console.log('');
  }

  // ── Recent Uploads ──
  const recent = stats.uploads.slice(-10).reverse();
  if (recent.length > 0) {
    console.log('  \x1b[36m  Recent Uploads\x1b[0m');
    console.log('');
    console.log('  \x1b[90m  Status  Title                                    Asset ID         Time\x1b[0m');
    console.log('  \x1b[90m  ──────  ────────────────────────────────────────  ───────────────  ────────────\x1b[0m');

    for (const u of recent) {
      const icon = u.success ? '\x1b[32m  OK  \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
      const title = (u.title || '').slice(0, 40).padEnd(40, ' ');
      const asset = (u.assetId ? String(u.assetId) : '-').padEnd(15, ' ');
      const time = u.timestamp ? new Date(u.timestamp).toLocaleTimeString() : '';
      console.log(`  ${icon}  ${title}  ${asset}  ${time}`);
    }
    console.log('');
  }
}

module.exports = {
  loadStats, saveStats, recordUpload, recordAccountCreated, recordModelsDownloaded,
  recordSession, printDashboard, getAccountUploadCount, getAccountsAtCap,
  getRemainingUploads, MODEL_CAP_PER_ACCOUNT,
};
