/**
 * Mirror — Train Pipeline (C1 → A1 → B1)
 *
 * Chains account generation (C1) into model analysis (A1) into AI titles (B1).
 * Each account flows through like a train:
 *   1. C1 creates & saves an account
 *   2. Account is immediately passed to A1
 *   3. A1 searches, downloads, analyzes, and injects into models
 *   4. B1 generates AI titles + emojis and renames the models
 */

const { generateOneAccount, loadAccounts } = require('./c1');
const { runA1 } = require('./a1');
const { runB1 } = require('./b1');

/**
 * Run the full C1 → A1 → B1 train pipeline.
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
  console.log('  ║        C1 → A1 → B1 (chained)            ║');
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
      console.log(`  [Train] C1 failed for account #${i} — skipping A1 & B1`);
      allResults.push({ train: i, account: null, a1: null, b1: null, error: 'c1_failed' });
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

    allResults.push({ train: i, account, a1: a1Results, b1: b1Results });
    console.log(`  [Train] Train ${i}/${accountCount} complete`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║              TRAIN PIPELINE SUMMARY                      ║');
  console.log('  ╠═══════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌───────┬──────────────────────┬────────────┬────────┬────────────────────────┐');
  console.log('  │ Train │ Account              │ C1 Status  │ Models │ B1 Titles              │');
  console.log('  ├───────┼──────────────────────┼────────────┼────────┼────────────────────────┤');

  for (const r of allResults) {
    const user = r.account ? r.account.username.slice(0, 20).padEnd(20, ' ') : 'FAILED'.padEnd(20, ' ');
    const c1Status = r.account ? r.account.status.slice(0, 10).padEnd(10, ' ') : 'failed'.padEnd(10, ' ');
    const modelCount = r.a1 ? String(r.a1.length).padStart(4, ' ') : '   -';
    const b1Count = r.b1 ? String(r.b1.filter(b => b.aiTitle).length).padStart(4, ' ') + ' titled' : '   -               ';
    console.log(`  │ ${String(r.train).padStart(5, ' ')} │ ${user} │ ${c1Status} │ ${modelCount}   │ ${String(b1Count).padEnd(22, ' ')} │`);
  }

  console.log('  └───────┴──────────────────────┴────────────┴────────┴────────────────────────┘');
  console.log('');

  return allResults;
}

module.exports = { runTrain };
