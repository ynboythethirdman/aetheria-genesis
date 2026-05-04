#!/usr/bin/env node
/**
 * Mirror — Roblox Automation Pipeline
 *
 * Made by Devin & Metro
 *
 * Usage:
 *   node src/mirror/index.js              # Interactive menu
 *   node src/mirror/index.js gen          # Generate accounts
 *   node src/mirror/index.js gen 5        # Generate 5 accounts
 *   node src/mirror/index.js grab         # Grab & modify models
 *   node src/mirror/index.js title        # AI title generation
 *   node src/mirror/index.js upload       # Upload models
 *   node src/mirror/index.js train        # Full pipeline
 *   node src/mirror/index.js stats        # View dashboard
 */

const readline = require('readline');
const { runC1, ACCOUNTS_FILE, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runTrain } = require('./pipeline');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');
const { printDashboard } = require('./stats');
const { startAutonomous, stopAutonomous } = require('./autonomous');
const { startBot } = require('./bot');

// ── CLI Helpers ──────────────────────────────────────────────────────

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Branding ─────────────────────────────────────────────────────────

const QUOTES = [
  '"Move in silence, let success make the noise."',
  '"We don\'t follow trends — we set them."',
  '"Built different. Coded different."',
  '"Stack in silence. Ship in volume."',
  '"The grind never stops. Neither does Mirror."',
  '"Automation is the new hustle."',
  '"While they sleep, Mirror works."',
  '"Less talk. More uploads."',
];

function getQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function printBanner() {
  const q = getQuote();
  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m                                                      \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m███╗   ███╗ ██╗ ██████╗  ██████╗   ██████╗  ██████╗\x1b[0m \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m████╗ ████║ ██║ ██╔══██╗ ██╔══██╗ ██╔═══██╗ ██╔══██╗\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m██╔████╔██║ ██║ ██████╔╝ ██████╔╝ ██║   ██║ ██████╔╝\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m██║╚██╔╝██║ ██║ ██╔══██╗ ██╔══██╗ ██║   ██║ ██╔══██╗\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m██║ ╚═╝ ██║ ██║ ██║  ██║ ██║  ██║ ╚██████╔╝ ██║  ██║\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[35m╚═╝     ╚═╝ ╚═╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝  ╚═════╝  ╚═╝  ╚═╝\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m                                                      \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[90mMade by \x1b[37mDevin\x1b[90m & \x1b[37mMetro\x1b[0m                               \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[36m' + q.slice(0, 52).padEnd(52, ' ') + '\x1b[0m\x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m                                                      \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
}

function printMenu() {
  console.log('  \x1b[35m┌──────────────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  \x1b[1mWhat do you want to do?\x1b[0m                          \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[1]\x1b[0m  Generate Accounts                           \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[2]\x1b[0m  Grab Models                                 \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[3]\x1b[0m  Generate Titles                              \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[4]\x1b[0m  Upload Models                                \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[5]\x1b[0m  \x1b[32mTrain\x1b[0m \x1b[90m(Full Pipeline)\x1b[0m                        \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[6]\x1b[0m  \x1b[32mAutomatic\x1b[0m \x1b[90m(Runs for days)\x1b[0m                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[7]\x1b[0m  \x1b[32mDiscord Bot\x1b[0m \x1b[90m(Mobile control)\x1b[0m               \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[8]\x1b[0m  Dashboard & Stats                            \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[0]\x1b[0m  Exit                                         \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────────────┘\x1b[0m');
  console.log('');
}

// ── Generate Accounts ────────────────────────────────────────────────

async function runGenInteractive(rl) {
  const countStr = await ask(rl, '  \x1b[36mHow many accounts?\x1b[0m [1]: ');
  const count = parseInt(countStr, 10) || 1;
  await runC1(count);
}

// ── Grab Models ──────────────────────────────────────────────────────

async function runGrabInteractive(rl) {
  const keyword = await ask(rl, '  \x1b[36mSearch keyword\x1b[0m (Enter to skip): ');

  console.log('');
  console.log('  \x1b[35m┌──────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  How many models?                          \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[A]\x1b[0m  Automatic (top 10)                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[#]\x1b[0m  Enter a number                      \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────┘\x1b[0m');
  console.log('');

  const countStr = await ask(rl, '  \x1b[36mChoice\x1b[0m [A]: ');
  const trimmed = countStr.trim().toLowerCase();
  const count = (!trimmed || trimmed === 'a') ? 'auto' : parseInt(trimmed, 10) || 'auto';

  const a1Results = await runA1({ keyword: keyword.trim(), count });
  return a1Results;
}

// ── Generate Titles ──────────────────────────────────────────────────

async function runTitleInteractive(rl) {
  console.log('');
  console.log('  \x1b[90mGenerating titles requires models. Running Grab Models first...\x1b[0m');
  console.log('');
  const a1Results = await runGrabInteractive(rl);
  if (!a1Results || a1Results.length === 0) {
    console.log('  \x1b[31mNo models to title.\x1b[0m');
    return;
  }
  const b1Results = await runB1(a1Results);
  return b1Results;
}

// ── Upload Models ────────────────────────────────────────────────────

async function runUploadInteractive(rl) {
  console.log('');
  console.log('  \x1b[90mUpload requires titled models. Running full flow...\x1b[0m');
  console.log('');
  const b1Results = await runTitleInteractive(rl);
  if (!b1Results || b1Results.length === 0) {
    console.log('  \x1b[31mNo models to upload.\x1b[0m');
    return;
  }

  const accounts = loadAccounts();
  const account = accounts.reverse().find((a) => a.cookie);
  if (!account) {
    console.log('  \x1b[31mNo account with cookie found. Run Generate Accounts or Train first.\x1b[0m');
    return;
  }

  await runB2(b1Results, account);
}

// ── Train ────────────────────────────────────────────────────────────

async function runTrainInteractive(rl) {
  console.log('');
  console.log('  \x1b[35m┌──────────────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  \x1b[1m\x1b[32mTrain Pipeline\x1b[0m                                   \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Generate Account \x1b[33m>\x1b[0m Grab Models \x1b[33m>\x1b[0m AI Titles       \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  \x1b[33m>\x1b[0m Upload to Roblox                                \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  All steps run automatically in sequence.        \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────────────┘\x1b[0m');
  console.log('');

  const acctStr = await ask(rl, '  \x1b[36mHow many accounts?\x1b[0m [1]: ');
  const accountCount = parseInt(acctStr, 10) || 1;

  const keyword = await ask(rl, '  \x1b[36mModel keyword\x1b[0m (Enter to skip): ');

  console.log('');
  console.log('  \x1b[35m┌──────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Models per account?                       \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[A]\x1b[0m  Automatic (top 10)                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m   \x1b[33m[#]\x1b[0m  Enter a number                      \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────┘\x1b[0m');
  console.log('');

  const modelStr = await ask(rl, '  \x1b[36mChoice\x1b[0m [A]: ');
  const trimmed = modelStr.trim().toLowerCase();
  const modelCount = (!trimmed || trimmed === 'a') ? 'auto' : parseInt(trimmed, 10) || 'auto';

  await runTrain({ accountCount, keyword: keyword.trim(), modelCount });
}

// ── Automatic Mode ───────────────────────────────────────────────────

async function runAutoInteractive(rl) {
  console.log('');
  console.log('  \x1b[35m┌──────────────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  \x1b[1m\x1b[32mAutomatic Mode\x1b[0m                                   \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Runs the full pipeline on repeat:               \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Gen > Grab > Title > Upload > \x1b[33mrepeat\x1b[0m             \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m                                                  \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Auto-rotates accounts at 200 model cap.         \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Auto-generates new accounts when needed.        \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m│\x1b[0m  Press Ctrl+C to stop.                           \x1b[35m│\x1b[0m');
  console.log('  \x1b[35m└──────────────────────────────────────────────────┘\x1b[0m');
  console.log('');

  const keyword = await ask(rl, '  \x1b[36mModel keyword\x1b[0m (Enter to skip): ');
  const modelsStr = await ask(rl, '  \x1b[36mModels per cycle?\x1b[0m [50]: ');
  const delayStr = await ask(rl, '  \x1b[36mDelay between cycles (seconds)?\x1b[0m [30]: ');

  const modelsPerCycle = parseInt(modelsStr, 10) || 50;
  const delayBetweenCycles = (parseInt(delayStr, 10) || 30) * 1000;

  rl.close();

  console.log('');
  console.log('  \x1b[32mStarting autonomous mode...\x1b[0m');
  console.log('  \x1b[90mPress Ctrl+C to stop\x1b[0m');
  console.log('');

  await startAutonomous({
    keyword: keyword.trim(),
    modelsPerCycle,
    delayBetweenCycles,
  });
}

// ── Dashboard ────────────────────────────────────────────────────────

function showDashboard() {
  const accounts = loadAccounts();
  printDashboard(accounts);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Direct command mode
  if (args[0] === 'gen' || args[0] === 'c1') {
    const count = parseInt(args[1], 10) || 1;
    await runC1(count);
    process.exit(0);
  }

  if (args[0] === 'train') {
    const rl = createPrompt();
    await runTrainInteractive(rl);
    rl.close();
    process.exit(0);
  }

  if (args[0] === 'grab' || args[0] === 'a1') {
    const rl = createPrompt();
    await runGrabInteractive(rl);
    rl.close();
    process.exit(0);
  }

  if (args[0] === 'title' || args[0] === 'b1') {
    const rl = createPrompt();
    await runTitleInteractive(rl);
    rl.close();
    process.exit(0);
  }

  if (args[0] === 'upload' || args[0] === 'b2') {
    const rl = createPrompt();
    await runUploadInteractive(rl);
    rl.close();
    process.exit(0);
  }

  if (args[0] === 'stats' || args[0] === 'dashboard') {
    showDashboard();
    process.exit(0);
  }

  if (args[0] === 'auto') {
    const rl = createPrompt();
    await runAutoInteractive(rl);
    process.exit(0);
  }

  if (args[0] === 'bot') {
    startBot();
    return; // bot keeps running
  }

  // Interactive menu mode
  printBanner();

  const rl = createPrompt();
  let running = true;

  while (running) {
    printMenu();
    const choice = await ask(rl, '  \x1b[35m>\x1b[0m ');

    switch (choice.trim()) {
      case '1':
        await runGenInteractive(rl);
        break;

      case '2':
        await runGrabInteractive(rl);
        break;

      case '3':
        await runTitleInteractive(rl);
        break;

      case '4':
        await runUploadInteractive(rl);
        break;

      case '5':
        await runTrainInteractive(rl);
        break;

      case '6':
        await runAutoInteractive(rl);
        break;

      case '7':
        console.log('');
        console.log('  \x1b[32mStarting Discord bot...\x1b[0m');
        console.log('  \x1b[90mUse /mirror start, /mirror stop, /mirror stats in Discord\x1b[0m');
        console.log('');
        rl.close();
        startBot();
        return;

      case '8':
        showDashboard();
        break;

      case '0':
      case 'exit':
      case 'quit':
        running = false;
        console.log('');
        console.log('  \x1b[90m' + getQuote() + '\x1b[0m');
        console.log('');
        break;

      default:
        console.log('  \x1b[31mInvalid choice.\x1b[0m Enter 1-8 or 0.');
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\x1b[31m[Mirror] Fatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
