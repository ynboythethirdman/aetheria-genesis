/**
 * Mirror — C1: Account Generation Process
 *
 * Creates Roblox accounts, navigates to settings, verifies email
 * (via Mail.tm) and phone (via SMSPool), then saves credentials.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { generateUsername, generatePassword } = require('./utils/names');
const { randomBetween } = require('./utils/timing');
const { createController, launch, createAccount, goToSettings, addEmailInSettings, enterEmailCode, addPhoneInSettings, enterPhoneCode, shutdown } = require('./browser/automation');
const { createEmail, waitForVerificationCode, deleteEmail } = require('./verification/mailTm');
const { purchaseNumber, waitForCode, cancelOrder } = require('./verification/smsPool');

const ACCOUNTS_FILE = path.resolve(__dirname, '..', '..', config.output.accountsFile);

/**
 * Load previously saved accounts.
 */
function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    }
  } catch { /* start fresh */ }
  return [];
}

/**
 * Save an account to the JSON file.
 */
function saveAccount(account) {
  const dir = path.dirname(ACCOUNTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const accounts = loadAccounts();
  accounts.push(account);
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  console.log(`[C1] Account saved → ${ACCOUNTS_FILE} (${accounts.length} total)`);
}

/**
 * Run the full C1 pipeline for a single account.
 *
 * @param {number} index - Account index (1-based)
 * @returns {Promise<object|null>} The saved account or null on failure
 */
async function generateOneAccount(index) {
  const tag = `Acct${index}`;
  const username = generateUsername();
  const password = generatePassword(config.account.passwordLength);
  const birthMonth = randomBetween(1, 12);
  const birthDay = randomBetween(1, 28);
  const birthYear = config.account.birthYear;

  console.log('');
  console.log(`  ┌─────────────────────────────────────────┐`);
  console.log(`  │  C1 — Account #${String(index).padStart(3, ' ')}                      │`);
  console.log(`  │  User: ${username.padEnd(32, ' ')}│`);
  console.log(`  └─────────────────────────────────────────┘`);

  const ctrl = createController(tag);
  let mailAccount = null;
  let smsOrder = null;

  const accountRecord = {
    username,
    password,
    email: null,
    emailVerified: false,
    phone: null,
    phoneVerified: false,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  try {
    // ── Step 1: Launch browser ─────────────────────────────────────────
    await launch(ctrl);

    // ── Step 2: Create the Roblox account ──────────────────────────────
    console.log(`[C1:${tag}] Creating account: ${username}`);
    const created = await createAccount(ctrl, {
      username,
      password,
      birthMonth,
      birthDay,
      birthYear,
    });

    if (!created) {
      accountRecord.status = 'signup_failed';
      saveAccount(accountRecord);
      return null;
    }

    accountRecord.status = 'created';

    // ── Step 3: Navigate to settings ───────────────────────────────────
    console.log(`[C1:${tag}] Navigating to settings...`);
    const onSettings = await goToSettings(ctrl);
    if (!onSettings) {
      accountRecord.status = 'settings_nav_failed';
      saveAccount(accountRecord);
      return accountRecord;
    }

    // ── Step 4: Email verification via Mail.tm ─────────────────────────
    console.log(`[C1:${tag}] Setting up temp email via Mail.tm...`);
    try {
      mailAccount = await createEmail();
      accountRecord.email = mailAccount.address;
      console.log(`[C1:${tag}] Temp email: ${mailAccount.address}`);

      const emailAdded = await addEmailInSettings(ctrl, mailAccount.address);
      if (emailAdded) {
        console.log(`[C1:${tag}] Waiting for verification email...`);
        const code = await waitForVerificationCode(mailAccount.token, tag);
        if (code) {
          if (code.startsWith('http')) {
            // It's a verification link — visit it in the browser
            await ctrl.page.goto(code, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
            accountRecord.emailVerified = true;
            console.log(`[C1:${tag}] Email verified via link`);
          } else {
            const codeEntered = await enterEmailCode(ctrl, code);
            accountRecord.emailVerified = codeEntered;
          }
        }
      }
    } catch (err) {
      console.error(`[C1:${tag}] Email verification error: ${err.message}`);
    }

    // ── Step 5: Phone verification via SMSPool ─────────────────────────
    if (config.sms.apiKey) {
      console.log(`[C1:${tag}] Ordering phone number via SMSPool...`);
      try {
        smsOrder = await purchaseNumber(tag);
        if (smsOrder) {
          const fullPhone = `${smsOrder.countryCode}${smsOrder.phoneNumber}`;
          accountRecord.phone = fullPhone;

          const phoneAdded = await addPhoneInSettings(ctrl, smsOrder.phoneNumber);
          if (phoneAdded) {
            console.log(`[C1:${tag}] Waiting for SMS code...`);
            const smsCode = await waitForCode(smsOrder.orderId, tag);
            if (smsCode) {
              const codeEntered = await enterPhoneCode(ctrl, smsCode);
              accountRecord.phoneVerified = codeEntered;
            }
          }
        }
      } catch (err) {
        console.error(`[C1:${tag}] Phone verification error: ${err.message}`);
      }
    } else {
      console.log(`[C1:${tag}] Skipping phone verification (no SMSPOOL_API_KEY)`);
    }

    // ── Step 6: Finalize ───────────────────────────────────────────────
    accountRecord.status = 'complete';
    if (accountRecord.emailVerified) accountRecord.status = 'email_verified';
    if (accountRecord.phoneVerified) accountRecord.status = 'fully_verified';

    saveAccount(accountRecord);

    console.log(`[C1:${tag}] Done — status: ${accountRecord.status}`);
    return accountRecord;
  } catch (err) {
    console.error(`[C1:${tag}] Fatal error: ${err.message}`);
    accountRecord.status = 'error';
    saveAccount(accountRecord);
    return null;
  } finally {
    // Cleanup
    if (mailAccount) deleteEmail(mailAccount.token, mailAccount.id).catch(() => {});
    if (smsOrder && !accountRecord.phoneVerified) cancelOrder(smsOrder.orderId).catch(() => {});
    await shutdown(ctrl);
  }
}

/**
 * Run C1 for N accounts sequentially.
 *
 * @param {number} count - Number of accounts to generate
 */
async function runC1(count) {
  count = count || config.account.count;

  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║           MIRROR — C1 PROCESS             ║');
  console.log('  ║      Roblox Account Generation            ║');
  console.log('  ║   + Email (Mail.tm) + Phone (SMSPool)     ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Generating ${count} account(s)...`);
  console.log(`  Accounts file: ${ACCOUNTS_FILE}`);
  console.log('');

  const results = [];
  for (let i = 1; i <= count; i++) {
    const result = await generateOneAccount(i);
    results.push(result);
  }

  // Summary
  const created = results.filter((r) => r && r.status !== 'signup_failed' && r.status !== 'error').length;
  const emailVerified = results.filter((r) => r && r.emailVerified).length;
  const phoneVerified = results.filter((r) => r && r.phoneVerified).length;

  console.log('');
  console.log('  ┌─────────────── C1 SUMMARY ──────────────┐');
  console.log(`  │  Total:          ${String(count).padStart(4, ' ')}                   │`);
  console.log(`  │  Created:        ${String(created).padStart(4, ' ')}                   │`);
  console.log(`  │  Email verified: ${String(emailVerified).padStart(4, ' ')}                   │`);
  console.log(`  │  Phone verified: ${String(phoneVerified).padStart(4, ' ')}                   │`);
  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  return results;
}

module.exports = { runC1, generateOneAccount, loadAccounts, saveAccount, ACCOUNTS_FILE };
