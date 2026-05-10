/**
 * Mirror — Mail.tm Integration
 *
 * Creates temporary email addresses and polls for incoming
 * verification emails. No API key required.
 *
 * API: https://api.mail.tm
 */

const config = require('../config');
const { sleep } = require('../utils/timing');

const API = config.mail.apiBase;

/**
 * Fetch available email domains from Mail.tm.
 * @returns {Promise<string[]>}
 */
async function getDomains() {
  const resp = await fetch(`${API}/domains`);
  const data = await resp.json();
  const items = data['hydra:member'] || data.member || data;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No Mail.tm domains available');
  }
  return items.map((d) => d.domain);
}

/**
 * Create a temporary email account.
 *
 * @param {string} [address] - Full email address (auto-generated if omitted)
 * @param {string} [password] - Password (auto-generated if omitted)
 * @returns {Promise<{id: string, address: string, password: string, token: string}>}
 */
async function createEmail(address, password) {
  const domains = await getDomains();
  const domain = domains[0];

  if (!address) {
    const rand = Math.random().toString(36).slice(2, 12);
    address = `mirror${rand}@${domain}`;
  }
  if (!password) {
    password = `MirPass${Math.random().toString(36).slice(2, 14)}!`;
  }

  // Create account
  const createResp = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Mail.tm create failed (${createResp.status}): ${err}`);
  }

  const account = await createResp.json();

  // Get auth token
  const tokenResp = await fetch(`${API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });

  if (!tokenResp.ok) {
    throw new Error(`Mail.tm token failed (${tokenResp.status})`);
  }

  const tokenData = await tokenResp.json();

  return {
    id: account.id,
    address,
    password,
    token: tokenData.token,
  };
}

/**
 * Fetch messages from the inbox.
 *
 * @param {string} token - Bearer token
 * @returns {Promise<Array>}
 */
async function getMessages(token) {
  const resp = await fetch(`${API}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data['hydra:member'] || data.member || data || [];
}

/**
 * Get full message content by ID.
 *
 * @param {string} token
 * @param {string} messageId
 * @returns {Promise<object>}
 */
async function getMessage(token, messageId) {
  const resp = await fetch(`${API}/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

/**
 * Poll inbox until a message from Roblox arrives, then extract the code.
 *
 * @param {string} token - Mail.tm bearer token
 * @param {string} tag - Log label
 * @returns {Promise<string|null>} Verification code or null
 */
async function waitForVerificationCode(token, tag) {
  console.log(`[Mail.tm:${tag}] Polling for Roblox verification email...`);

  for (let i = 0; i < config.mail.maxPollAttempts; i++) {
    const messages = await getMessages(token);

    for (const msg of messages) {
      const from = (msg.from && msg.from.address) || '';
      const subject = msg.subject || '';

      if (from.includes('roblox') || subject.toLowerCase().includes('roblox') || subject.toLowerCase().includes('verif')) {
        const full = await getMessage(token, msg.id);
        if (!full) continue;

        const body = full.text || full.html || '';
        // Roblox verification codes are typically 6-digit numbers
        const codeMatch = body.match(/\b(\d{6})\b/);
        if (codeMatch) {
          console.log(`[Mail.tm:${tag}] Found verification code: ${codeMatch[1]}`);
          return codeMatch[1];
        }

        // Also check for verification links
        const linkMatch = body.match(/https?:\/\/[^\s"'<>]+verif[^\s"'<>]*/i);
        if (linkMatch) {
          console.log(`[Mail.tm:${tag}] Found verification link: ${linkMatch[0]}`);
          return linkMatch[0];
        }
      }
    }

    await sleep(config.mail.pollIntervalMs);
  }

  console.log(`[Mail.tm:${tag}] Timed out waiting for verification email`);
  return null;
}

/**
 * Delete the temporary email account.
 */
async function deleteEmail(token, accountId) {
  try {
    await fetch(`${API}/accounts/${accountId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* best effort */ }
}

module.exports = {
  getDomains,
  createEmail,
  getMessages,
  getMessage,
  waitForVerificationCode,
  deleteEmail,
};
