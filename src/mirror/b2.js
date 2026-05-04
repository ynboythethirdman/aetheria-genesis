/**
 * Mirror — B2: Model Publisher
 *
 * Final step in the pipeline. After B1 generates AI titles/descriptions/tags,
 * B2 publishes each modified model to the Roblox Creator Marketplace using
 * the account created by C1.
 *
 * Upload method:
 *   1. Primary — Legacy data.roblox.com/Data/Upload.ashx API (cookie auth + CSRF)
 *   2. Fallback — Playwright browser automation via create.roblox.com
 *
 * Flow: reads the renamed .rbxmx + _desc.txt files from B1 → uploads → returns asset IDs
 */

const fs = require('fs');
const path = require('path');
const { notifyModelUploaded } = require('./discord');
const { recordUpload } = require('./stats');
const { runPool } = require('./utils/pool');
const config = require('./config');

// ── CSRF Token Helper ────────────────────────────────────────────────

/**
 * Fetch an X-CSRF-TOKEN from Roblox by making a POST that intentionally
 * returns 403 with the token in the response header.
 *
 * @param {string} cookie - .ROBLOSECURITY cookie value
 * @returns {Promise<string>} The CSRF token
 */
async function fetchCsrfToken(cookie) {
  const resp = await fetch('https://auth.roblox.com/v2/logout', {
    method: 'POST',
    headers: {
      'Cookie': `.ROBLOSECURITY=${cookie}`,
    },
  });

  const token = resp.headers.get('x-csrf-token');
  if (!token) {
    throw new Error('Failed to get CSRF token — cookie may be invalid');
  }
  return token;
}

// ── Get User ID from Cookie ──────────────────────────────────────────

/**
 * Get the authenticated user's info from the cookie.
 *
 * @param {string} cookie - .ROBLOSECURITY cookie value
 * @returns {Promise<{id: number, name: string}>}
 */
async function getAuthenticatedUser(cookie) {
  const resp = await fetch('https://users.roblox.com/v1/users/authenticated', {
    headers: {
      'Cookie': `.ROBLOSECURITY=${cookie}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get user info (${resp.status}) — cookie may be expired`);
  }

  const data = await resp.json();
  return { id: data.id, name: data.name || data.displayName };
}

// ── Upload via Legacy API ────────────────────────────────────────────

/**
 * Upload a model to Roblox using the legacy data.roblox.com endpoint.
 *
 * @param {object} options
 * @param {string} options.cookie - .ROBLOSECURITY cookie
 * @param {string} options.csrfToken - X-CSRF-TOKEN
 * @param {Buffer|string} options.modelData - The .rbxmx file content
 * @param {string} options.name - Display name for the model
 * @param {string} options.description - Model description (promo + tags)
 * @returns {Promise<{success: boolean, assetId: number|null, error: string|null}>}
 */
async function uploadModelLegacy(options) {
  const { cookie, csrfToken, modelData, name, description } = options;

  const params = new URLSearchParams({
    json: '1',
    type: 'Model',
    genreTypeId: '1',
    name: name.substring(0, 50),
    description: description.substring(0, 1000),
    ispublic: 'true',
    allowComments: 'true',
  });

  try {
    const resp = await fetch(`https://data.roblox.com/Data/Upload.ashx?${params}`, {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': 'application/xml',
        'User-Agent': 'RobloxStudio/1.0',
      },
      body: modelData,
    });

    if (resp.status === 403) {
      // CSRF token expired — retry with new token
      const newToken = resp.headers.get('x-csrf-token');
      if (newToken) {
        return uploadModelLegacy({ ...options, csrfToken: newToken });
      }
      return { success: false, assetId: null, error: `403 Forbidden — CSRF refresh failed` };
    }

    if (!resp.ok) {
      const body = await resp.text();
      return { success: false, assetId: null, error: `${resp.status}: ${body.substring(0, 200)}` };
    }

    const body = await resp.text();
    let assetId = null;

    // Response is either a JSON object or just the asset ID as text
    try {
      const parsed = JSON.parse(body);
      assetId = parsed.AssetId || parsed.assetId || parsed.Id || parsed.id || null;
    } catch {
      // Might be a plain number
      const num = parseInt(body, 10);
      if (!isNaN(num)) assetId = num;
    }

    return { success: true, assetId, error: null };
  } catch (err) {
    return { success: false, assetId: null, error: err.message };
  }
}

// ── Upload via Open Cloud API ────────────────────────────────────────

/**
 * Upload a model using the Open Cloud Assets API.
 * Requires: the account's userId (from getAuthenticatedUser) and cookie.
 *
 * @param {object} options
 * @param {string} options.cookie - .ROBLOSECURITY cookie
 * @param {string} options.csrfToken - X-CSRF-TOKEN
 * @param {number} options.userId - Roblox user ID
 * @param {Buffer} options.modelData - The .rbxmx file content
 * @param {string} options.name - Display name
 * @param {string} options.description - Description
 * @returns {Promise<{success: boolean, assetId: number|null, operationId: string|null, error: string|null}>}
 */
async function uploadModelOpenCloud(options) {
  const { cookie, csrfToken, userId, modelData, name, description } = options;

  const boundary = '----RobloxMirrorBoundary' + Date.now();
  const requestJson = JSON.stringify({
    assetType: 'Model',
    displayName: name.substring(0, 50),
    description: description.substring(0, 1000),
    creationContext: {
      creator: {
        userId: String(userId),
      },
    },
  });

  // Build multipart/form-data body manually
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="request"\r\n`;
  body += `Content-Type: application/json\r\n\r\n`;
  body += requestJson + '\r\n';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="fileContent"; filename="model.rbxmx"\r\n`;
  body += `Content-Type: application/xml\r\n\r\n`;

  const bodyStart = Buffer.from(body, 'utf-8');
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const modelBuf = Buffer.isBuffer(modelData) ? modelData : Buffer.from(modelData, 'utf-8');
  const fullBody = Buffer.concat([bodyStart, modelBuf, bodyEnd]);

  try {
    const resp = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });

    if (resp.status === 403) {
      const newToken = resp.headers.get('x-csrf-token');
      if (newToken) {
        return uploadModelOpenCloud({ ...options, csrfToken: newToken });
      }
    }

    if (!resp.ok) {
      const errBody = await resp.text();
      return { success: false, assetId: null, operationId: null, error: `${resp.status}: ${errBody.substring(0, 200)}` };
    }

    const data = await resp.json();
    const operationId = data.path || data.operationId || null;
    return { success: true, assetId: null, operationId, error: null };
  } catch (err) {
    return { success: false, assetId: null, operationId: null, error: err.message };
  }
}

// ── Main B2 Runner ───────────────────────────────────────────────────

/**
 * Run B2: publish all B1 results to Roblox.
 *
 * @param {Array} b1Results - Results from runB1 (each has .listing, .model, etc.)
 * @param {object} account - C1 account with .cookie field
 * @returns {Promise<Array>} Results with added .published fields
 */
async function runB2(b1Results, account) {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║           MIRROR — B2 PROCESS             ║');
  console.log('  ║      Model Publisher (Roblox)             ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');

  if (!account || !account.cookie) {
    console.log('[B2] No account cookie available — cannot publish');
    console.log('[B2] Run the Train pipeline (C1 → A1 → B1 → B2) to create an account first');
    return b1Results;
  }

  // Verify the cookie is still valid
  let user;
  try {
    user = await getAuthenticatedUser(account.cookie);
    console.log(`  Account: ${user.name} (ID: ${user.id})`);
  } catch (err) {
    console.error(`[B2] Cookie invalid: ${err.message}`);
    return b1Results;
  }

  // Get CSRF token
  let csrfToken;
  try {
    csrfToken = await fetchCsrfToken(account.cookie);
    console.log('  CSRF:    obtained');
  } catch (err) {
    console.error(`[B2] CSRF error: ${err.message}`);
    return b1Results;
  }

  const publishable = b1Results.filter((r) => r.listing && r.listing.modelPath);
  const UPLOAD_CONCURRENCY = config.concurrency.uploads;
  console.log(`  Models:  ${publishable.length}`);
  console.log(`  Threads: ${UPLOAD_CONCURRENCY}`);
  console.log('');

  // Upload all publishable models concurrently
  let uploadedCount = 0;
  const uploadResults = await runPool(publishable, async (result) => {
    const listing = result.listing;

    let modelData;
    try {
      modelData = fs.readFileSync(listing.modelPath);
    } catch (err) {
      return { result, published: { success: false, error: err.message } };
    }

    // Try legacy upload first
    let uploadResult = await uploadModelLegacy({
      cookie: account.cookie,
      csrfToken,
      modelData,
      name: listing.title,
      description: listing.description,
    });

    // If legacy fails, try Open Cloud API
    if (!uploadResult.success) {
      uploadResult = await uploadModelOpenCloud({
        cookie: account.cookie,
        csrfToken,
        userId: user.id,
        modelData,
        name: listing.title,
        description: listing.description,
      });
    }

    const assetId = uploadResult.assetId || uploadResult.operationId || null;

    // Record stats + Discord webhook (fire and forget)
    recordUpload(listing.title, assetId, account.username, uploadResult.success);
    notifyModelUploaded({
      title: listing.title,
      assetId,
      account: account.username,
      tags: listing.tags,
      status: uploadResult.success ? 'Uploaded' : `Failed: ${uploadResult.error}`,
    }).catch(() => {});

    uploadedCount++;
    if (uploadedCount % 10 === 0 || uploadedCount === publishable.length) {
      const ok = uploadResult.success ? '\x1b[32mOK\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`[B2] ${uploadedCount}/${publishable.length} uploaded — last: ${ok} ${listing.title.slice(0, 40)}`);
    }

    return {
      result,
      published: {
        success: uploadResult.success,
        assetId: uploadResult.assetId || null,
        operationId: uploadResult.operationId || null,
        error: uploadResult.error,
      },
    };
  }, UPLOAD_CONCURRENCY);

  // Build final results array preserving order
  const b2Results = [];
  let uploadIdx = 0;
  for (const b1Result of b1Results) {
    if (!b1Result.listing || !b1Result.listing.modelPath) {
      b2Results.push({ ...b1Result, published: null });
    } else {
      const ur = uploadResults[uploadIdx++];
      b2Results.push({ ...b1Result, published: ur.published });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔════════════════════════════════════════════════════════════════════════╗');
  console.log('  ║                       B2 PUBLISH RESULTS                              ║');
  console.log('  ╠════════════════════════════════════════════════════════════════════════╣');
  console.log('');
  console.log('  ┌─────┬──────────────────────────────────────────────┬──────────┬──────────────┐');
  console.log('  │  #  │ Title                                        │ Status   │ Asset ID     │');
  console.log('  ├─────┼──────────────────────────────────────────────┼──────────┼──────────────┤');

  for (let i = 0; i < b2Results.length; i++) {
    const r = b2Results[i];
    const title = (r.listing?.title || 'N/A').slice(0, 44).padEnd(44, ' ');
    const status = r.published?.success ? 'OK'.padEnd(8, ' ') : 'FAILED'.padEnd(8, ' ');
    const assetId = r.published?.assetId
      ? String(r.published.assetId).padEnd(12, ' ')
      : (r.published?.operationId || '-').toString().slice(0, 12).padEnd(12, ' ');
    console.log(`  │ ${String(i + 1).padStart(3, ' ')} │ ${title} │ ${status} │ ${assetId} │`);
  }

  console.log('  └─────┴──────────────────────────────────────────────┴──────────┴──────────────┘');

  const successCount = b2Results.filter((r) => r.published?.success).length;
  const failCount = b2Results.filter((r) => r.published && !r.published.success).length;
  console.log('');
  console.log(`  Published: ${successCount}  |  Failed: ${failCount}  |  Skipped: ${b2Results.length - successCount - failCount}`);
  console.log('');

  return b2Results;
}

module.exports = { runB2, fetchCsrfToken, getAuthenticatedUser, uploadModelLegacy, uploadModelOpenCloud };
