/**
 * Mirror — Train Pipeline (Gen > Grab > Title > Upload)
 *
 * Full pipeline with concurrent processing:
 *   1. C1 generates a pool of accounts upfront
 *   2. A1 grabs models concurrently (25 threads)
 *   3. B1 generates AI titles concurrently (15 threads)
 *   4. B2 publishes models concurrently (15 threads per account)
 *
 * Accounts are distributed round-robin for uploads.
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');
const { notifyPipelineSummary } = require('./discord');
const { recordSession } = require('./stats');
const { runPool } = require('./utils/pool');

/**
 * Run the full pipeline.
 *
 * @param {object} options
 * @param {number} options.accountCount - Number of accounts to generate (pool size)
 * @param {string} options.keyword - Model search keyword (optional)
 * @param {number|'auto'} options.modelCount - Models per account
 * @returns {Promise<object>} Combined results
 */
async function runTrain(options) {
  const { accountCount, keyword, modelCount } = options;
  const startTime = Date.now();

  console.log('');
  console.log('  \x1b[35m╔═══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m        \x1b[1m\x1b[32mMIRROR — TRAIN PIPELINE\x1b[0m                       \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m     Gen > Grab > Title > Upload                      \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m╚═══════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  Accounts:  \x1b[33m${accountCount}\x1b[0m`);
  console.log(`  Keyword:   \x1b[33m${keyword || '(popular models)'}\x1b[0m`);
  console.log(`  Models:    \x1b[33m${modelCount === 'auto' ? 'Automatic (top 10)' : modelCount + ' per account'}\x1b[0m`);
  console.log('');

  // ── Phase 1: Generate Account Pool ─────────────────────────────────
  console.log('  \x1b[35m━━━ Phase 1: Generating Account Pool ━━━\x1b[0m');
  console.log('');

  const accounts = [];
  for (let i = 1; i <= accountCount; i++) {
    console.log(`  [Gen] Creating account ${i}/${accountCount}...`);
    const account = await generateOneAccount(i);
    if (account) {
      accounts.push(account);
      console.log(`  [Gen] \x1b[32m${account.username}\x1b[0m ready (cookie: ${account.cookie ? 'yes' : 'no'})`);
    } else {
      console.log(`  [Gen] \x1b[31mAccount ${i} failed\x1b[0m`);
    }
  }

  if (accounts.length === 0) {
    console.log('  \x1b[31mNo accounts created — aborting pipeline.\x1b[0m');
    return { accounts: [], results: [] };
  }

  console.log('');
  console.log(`  \x1b[32m${accounts.length} account(s) ready.\x1b[0m`);
  console.log('');

  // ── Phase 2: Grab Models (concurrent) ──────────────────────────────
  console.log('  \x1b[35m━━━ Phase 2: Grabbing Models ━━━\x1b[0m');
  console.log('');

  const a1Results = await runA1({
    keyword: keyword || '',
    count: modelCount || 'auto',
    account: accounts[0],
  });

  if (!a1Results || a1Results.length === 0) {
    console.log('  \x1b[31mNo models grabbed — aborting.\x1b[0m');
    return { accounts, results: [] };
  }

  // ── Phase 3: Generate Titles (concurrent) ──────────────────────────
  console.log('');
  console.log('  \x1b[35m━━━ Phase 3: Generating Titles ━━━\x1b[0m');
  console.log('');

  const b1Results = await runB1(a1Results);

  // ── Phase 4: Upload Models (concurrent, distributed across accounts) ─
  console.log('');
  console.log('  \x1b[35m━━━ Phase 4: Uploading Models ━━━\x1b[0m');
  console.log('');

  const accountsWithCookies = accounts.filter((a) => a.cookie);
  if (accountsWithCookies.length === 0) {
    console.log('  \x1b[31mNo accounts with cookies — cannot upload.\x1b[0m');
    return { accounts, results: b1Results };
  }

  // Distribute models across accounts round-robin
  const publishable = b1Results.filter((r) => r.listing && r.listing.modelPath);
  const chunks = [];
  for (let i = 0; i < accountsWithCookies.length; i++) {
    chunks.push([]);
  }
  for (let i = 0; i < publishable.length; i++) {
    chunks[i % accountsWithCookies.length].push(publishable[i]);
  }

  console.log(`  Distributing ${publishable.length} models across ${accountsWithCookies.length} account(s)`);
  for (let i = 0; i < chunks.length; i++) {
    console.log(`    ${accountsWithCookies[i].username}: ${chunks[i].length} models`);
  }
  console.log('');

  // Upload concurrently — each account processes its chunk
  const allB2Results = await Promise.all(
    chunks.map((chunk, idx) => {
      if (chunk.length === 0) return Promise.resolve([]);
      return runB2(chunk, accountsWithCookies[idx]);
    })
  );

  // Merge results back
  const b2Flat = allB2Results.flat();

  // ── Summary ────────────────────────────────────────────────────────
  const elapsed = Date.now() - startTime;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  const duration = `${mins}m ${secs}s`;

  const totalPublished = b2Flat.filter((r) => r.published?.success).length;
  const totalFailed = b2Flat.filter((r) => r.published && !r.published.success).length;

  console.log('');
  console.log('  \x1b[35m╔══════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m              \x1b[1mTRAIN PIPELINE COMPLETE\x1b[0m                    \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m╠══════════════════════════════════════════════════════════╣\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m                                                          \x1b[35m║\x1b[0m');
  console.log(`  \x1b[35m║\x1b[0m   Accounts Created    \x1b[33m${String(accounts.length).padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Models Grabbed      \x1b[33m${String(a1Results.length).padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Titles Generated    \x1b[33m${String(b1Results.filter((r) => r.listing).length).padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Models Uploaded     \x1b[32m${String(totalPublished).padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Upload Failures     \x1b[31m${String(totalFailed).padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Duration            \x1b[90m${duration.padEnd(6)}\x1b[0m                          \x1b[35m║\x1b[0m`);
  console.log('  \x1b[35m║\x1b[0m                                                          \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m╚══════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');

  const sessionSummary = {
    accountsCreated: accounts.length,
    modelsDownloaded: a1Results.length,
    modelsTitled: b1Results.filter((r) => r.listing).length,
    modelsPublished: totalPublished,
    modelsFailed: totalFailed,
    duration,
  };

  recordSession(sessionSummary);
  await notifyPipelineSummary(sessionSummary);

  return { accounts, a1Results, b1Results, b2Results: b2Flat };
}

module.exports = { runTrain };
