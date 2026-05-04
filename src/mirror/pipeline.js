/**
 * Mirror — Train Pipeline (C1 → A1 → B1 → B2)
 *
 * Full pipeline: account generation → model analysis → AI titles → publish.
 * Each account flows through like a train:
 *   1. C1 creates & saves an account (extracts .ROBLOSECURITY cookie)
 *   2. Account is immediately passed to A1
 *   3. A1 searches, downloads, analyzes, and injects into models
 *   4. B1 generates AI titles + emojis and renames the models
 *   5. B2 publishes the models to Roblox under the C1 account
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');
const { runB2 } = require('./b2');

/**
 * Run the full C1 → A1 → B1 → B2 train pipeline.
 *
 * @param {object} options
 * @param {number} options.accountCount - Number of accounts to generate
 * @param {string} options.keyword - Model search keyword (optional)
 * @param {number|'auto'} options.modelCount - Models per account
 * @returns {Promise<Array>} Combined results
 */
async function runTrain(options) {
  const { accountCount, keyword, modelCount } = options;

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║        MIRROR — TRAIN PIPELINE            ║');
  console.log('  ║     C1 → A1 → B1 → B2 (chained)         ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Accounts:  ${accountCount}`);
  console.log(`  Keyword:   ${keyword || '(popular models)'}`);
  console.log(`  Models:    ${modelCount === 'auto' ? 'Automatic (top 10)' : modelCount}`);
  console.log('');

  const allResults = [];

  for (let i = 1; i <= accountCount; i++) {
    console.log('');
    console.log(`  ═══ Train ${i}/${accountCount} ════════════════════════════`);
    console.log('');

    // ── C1: Generate account ───────────────────────────────────────
    console.log(`  [Train] C1 → Generating account #${i}...`);
    const account = await generateOneAccount(i);

    if (!account) {
      console.log(`  [Train] C1 failed for account #${i} — skipping A1/B1/B2`);
      allResults.push({ train: i, account: null, a1: null, b1: null, b2: null, error: 'c1_failed' });
      continue;
    }

    console.log(`  [Train] C1 done → ${account.username} (${account.status})`);

    // ── A1: Analyze models with this account ───────────────────────
    console.log(`  [Train] A1 → Using account: ${account.username}`);
    const a1Results = await runA1({
      keyword: keyword || '',
      count: modelCount || 'auto',
      account,
    });

    // ── B1: AI title generation ────────────────────────────────────
    console.log(`  [Train] B1 → Generating AI titles...`);
    const b1Results = await runB1(a1Results);

    // ── B2: Publish to Roblox ──────────────────────────────────────
    console.log(`  [Train] B2 → Publishing models...`);
    const b2Results = await runB2(b1Results, account);

    allResults.push({ train: i, account, a1: a1Results, b1: b1Results, b2: b2Results });
    console.log(`  [Train] Train ${i}/${accountCount} complete`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('  ║                         TRAIN PIPELINE SUMMARY                              ║');
  console.log('  ╠══════════════════════════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌───────┬──────────────────────┬────────────┬────────┬──────────┬─────────────┐');
  console.log('  │ Train │ Account              │ C1 Status  │ Models │ Titled   │ Published   │');
  console.log('  ├───────┼──────────────────────┼────────────┼────────┼──────────┼─────────────┤');

  for (const r of allResults) {
    const user = r.account ? r.account.username.slice(0, 20).padEnd(20, ' ') : 'FAILED'.padEnd(20, ' ');
    const c1Status = r.account ? r.account.status.slice(0, 10).padEnd(10, ' ') : 'failed'.padEnd(10, ' ');
    const models = r.a1 ? String(r.a1.length).padStart(4, ' ') : '   -';
    const titled = r.b1 ? String(r.b1.filter((b) => b.listing).length).padStart(4, ' ') : '   -';
    const published = r.b2 ? String(r.b2.filter((b) => b.published?.success).length).padStart(4, ' ') : '   -';
    console.log(`  │ ${String(r.train).padStart(5, ' ')} │ ${user} │ ${c1Status} │ ${models}   │ ${titled}     │ ${published}        │`);
  }

  console.log('  └───────┴──────────────────────┴────────────┴────────┴──────────┴─────────────┘');
  console.log('');

  return allResults;
}

module.exports = { runTrain };
