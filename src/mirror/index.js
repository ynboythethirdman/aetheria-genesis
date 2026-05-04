#!/usr/bin/env node
/**
 * Mirror — Main Entry Point
 *
 * Interactive CLI with two processes:
 *   C1  →  Roblox Account Generation + Verification
 *   A1  →  Model Search, Download (.rbxmx), & Deep-Nest Analysis
 *
 * Usage:
 *   node src/mirror/index.js              # Interactive menu
 *   node src/mirror/index.js c1           # Run C1 directly
 *   node src/mirror/index.js c1 5         # C1 with 5 accounts
 *   node src/mirror/index.js a1           # Run A1 directly
 */

const readline = require('readline');
const { runC1, ACCOUNTS_FILE } = require('./c1');
const { runA1 } = require('./a1');
const { runTrain } = require('./pipeline');

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

function printBanner() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║              M I R R O R                  ║');
  console.log('  ║                                           ║');
  console.log('  ║   C1     Account Generation               ║');
  console.log('  ║   A1     Model Search & Analysis          ║');
  console.log('  ║   Train  C1 → A1 Pipeline                 ║');
  console.log('  ║                                           ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
}

function printMenu() {
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │  Choose a process:                      │');
  console.log('  │                                         │');
  console.log('  │   [1]  C1 — Generate Roblox Accounts    │');
  console.log('  │   [2]  A1 — Search & Analyze Models     │');
  console.log('  │   [3]  Train — C1 → A1 Pipeline        │');
  console.log('  │   [4]  View Saved Accounts              │');
  console.log('  │   [0]  Exit                             │');
  console.log('  │                                         │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
}

// ── C1 Interactive ───────────────────────────────────────────────────

async function runC1Interactive(rl) {
  const countStr = await ask(rl, '  How many accounts to generate? [1]: ');
  const count = parseInt(countStr, 10) || 1;
  await runC1(count);
}

// ── A1 Interactive ───────────────────────────────────────────────────

async function runA1Interactive(rl) {
  const keyword = await ask(rl, '  Enter search keyword (or press Enter for popular models): ');

  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │  How many models?                       │');
  console.log('  │                                         │');
  console.log('  │   [A]  Automatic (top 10 popular)       │');
  console.log('  │   [#]  Enter a specific number          │');
  console.log('  │                                         │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  const countStr = await ask(rl, '  Choice [A]: ');
  const trimmed = countStr.trim().toLowerCase();
  const count = (!trimmed || trimmed === 'a') ? 'auto' : parseInt(trimmed, 10) || 'auto';

  await runA1({ keyword: keyword.trim(), count });
}

// ── View Accounts ────────────────────────────────────────────────────

function viewAccounts() {
  const fs = require('fs');
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      console.log('  No accounts saved yet.');
      return;
    }
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    if (accounts.length === 0) {
      console.log('  No accounts saved yet.');
      return;
    }

    console.log('');
    console.log(`  Saved Accounts (${accounts.length}):`);
    console.log('');
    console.log('  ┌─────┬──────────────────────┬───────────────────────────────┬────────────────┐');
    console.log('  │  #  │ Username             │ Email                         │ Status         │');
    console.log('  ├─────┼──────────────────────┼───────────────────────────────┼────────────────┤');

    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      const user = (a.username || '').slice(0, 20).padEnd(20, ' ');
      const email = (a.email || 'none').slice(0, 29).padEnd(29, ' ');
      const status = (a.status || 'unknown').slice(0, 14).padEnd(14, ' ');
      console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${user} │ ${email} │ ${status} │`);
    }

    console.log('  └─────┴──────────────────────┴───────────────────────────────┴────────────────┘');
    console.log('');
  } catch (err) {
    console.error(`  Error reading accounts: ${err.message}`);
  }
}

// ── Train Interactive ────────────────────────────────────────────────

async function runTrainInteractive(rl) {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │  Train Pipeline: C1 → A1                │');
  console.log('  │  Creates accounts then immediately      │');
  console.log('  │  uses them for model analysis.           │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  const acctStr = await ask(rl, '  How many accounts to generate? [1]: ');
  const accountCount = parseInt(acctStr, 10) || 1;

  const keyword = await ask(rl, '  Model search keyword (Enter to skip): ');

  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │  How many models per account?           │');
  console.log('  │                                         │');
  console.log('  │   [A]  Automatic (top 10 popular)       │');
  console.log('  │   [#]  Enter a specific number          │');
  console.log('  │                                         │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  const modelStr = await ask(rl, '  Choice [A]: ');
  const trimmed = modelStr.trim().toLowerCase();
  const modelCount = (!trimmed || trimmed === 'a') ? 'auto' : parseInt(trimmed, 10) || 'auto';

  await runTrain({ accountCount, keyword: keyword.trim(), modelCount });
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Direct command mode
  if (args[0] === 'c1') {
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

  if (args[0] === 'a1') {
    const rl = createPrompt();
    await runA1Interactive(rl);
    rl.close();
    process.exit(0);
  }

  // Interactive menu mode
  printBanner();

  const rl = createPrompt();
  let running = true;

  while (running) {
    printMenu();
    const choice = await ask(rl, '  > ');

    switch (choice.trim()) {
      case '1':
        await runC1Interactive(rl);
        break;

      case '2':
        await runA1Interactive(rl);
        break;

      case '3':
        await runTrainInteractive(rl);
        break;

      case '4':
        viewAccounts();
        break;

      case '0':
      case 'exit':
      case 'quit':
        running = false;
        console.log('  Goodbye.');
        break;

      default:
        console.log('  Invalid choice. Enter 1, 2, 3, 4, or 0.');
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[Mirror] Fatal: ${err.message}`);
  process.exit(1);
});
