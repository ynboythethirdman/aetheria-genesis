/**
 * Mirror — SMSPool Integration
 *
 * Orders virtual phone numbers and polls for incoming SMS codes
 * via https://api.smspool.net.
 *
 * Requires SMSPOOL_API_KEY environment variable.
 */

const config = require('../config');
const { sleep } = require('../utils/timing');

const API = config.sms.apiBase;
const API_KEY = config.sms.apiKey;

/**
 * Check SMSPool account balance.
 * @returns {Promise<number>} Balance in USD
 */
async function getBalance() {
  const resp = await fetch(`${API}/request/balance?key=${API_KEY}`);
  const data = await resp.json();
  return parseFloat(data.balance || '0');
}

/**
 * Get the list of available countries.
 * @returns {Promise<Array>}
 */
async function getCountries() {
  const resp = await fetch(`${API}/country/retrieve_all`);
  return resp.json();
}

/**
 * Get available services, optionally filtered by country.
 * @param {string} [country] - Country ID
 * @returns {Promise<Array>}
 */
async function getServices(country) {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  const resp = await fetch(`${API}/service/retrieve_all?${params}`);
  return resp.json();
}

/**
 * Find the Roblox service ID from the service list.
 * @returns {Promise<string|null>}
 */
async function findRobloxServiceId() {
  if (config.sms.service) return config.sms.service;

  const services = await getServices(config.sms.country);
  if (!Array.isArray(services)) return null;

  const roblox = services.find((s) => {
    const name = (s.name || s.service || '').toLowerCase();
    return name.includes('roblox');
  });

  return roblox ? String(roblox.ID || roblox.id || roblox.service_id) : null;
}

/**
 * Purchase an SMS number for Roblox verification.
 *
 * @param {string} tag - Log label
 * @returns {Promise<{orderId: string, phoneNumber: string, countryCode: string}|null>}
 */
async function purchaseNumber(tag) {
  if (!API_KEY) {
    console.log(`[SMSPool:${tag}] No SMSPOOL_API_KEY set - skipping phone verification`);
    return null;
  }

  const serviceId = await findRobloxServiceId();
  if (!serviceId) {
    console.error(`[SMSPool:${tag}] Could not find Roblox service on SMSPool`);
    return null;
  }

  console.log(`[SMSPool:${tag}] Ordering number (country=${config.sms.country}, service=${serviceId})...`);

  const params = new URLSearchParams({
    key: API_KEY,
    country: config.sms.country,
    service: serviceId,
  });

  const resp = await fetch(`${API}/purchase/sms?${params}`);
  const data = await resp.json();

  if (data.success === 0 || data.error) {
    console.error(`[SMSPool:${tag}] Purchase failed: ${data.message || data.error || JSON.stringify(data)}`);
    return null;
  }

  const orderId = String(data.order_id || data.orderId || '');
  const phoneNumber = data.phonenumber || data.number || data.phone_number || '';
  const countryCode = data.cc || data.country_code || '';

  if (!orderId) {
    console.error(`[SMSPool:${tag}] No order ID in response: ${JSON.stringify(data)}`);
    return null;
  }

  console.log(`[SMSPool:${tag}] Got number: ${countryCode}${phoneNumber} (order ${orderId})`);
  return { orderId, phoneNumber, countryCode };
}

/**
 * Poll for the SMS verification code.
 *
 * @param {string} orderId
 * @param {string} tag - Log label
 * @returns {Promise<string|null>} The SMS code or null
 */
async function waitForCode(orderId, tag) {
  console.log(`[SMSPool:${tag}] Polling for SMS code (order ${orderId})...`);

  for (let i = 0; i < config.sms.maxPollAttempts; i++) {
    const resp = await fetch(`${API}/sms/check?key=${API_KEY}&orderid=${orderId}`);
    const data = await resp.json();

    const status = String(data.status || '');

    if (status === '3' || status.toLowerCase() === 'completed') {
      const sms = data.sms || data.code || data.message || '';
      const codeMatch = sms.match(/\b(\d{4,6})\b/);
      if (codeMatch) {
        console.log(`[SMSPool:${tag}] SMS code received: ${codeMatch[1]}`);
        return codeMatch[1];
      }
      console.log(`[SMSPool:${tag}] SMS received but no code found: ${sms}`);
      return sms;
    }

    if (status === '6' || status.toLowerCase().includes('cancel') || status.toLowerCase().includes('refund')) {
      console.log(`[SMSPool:${tag}] Order cancelled/refunded`);
      return null;
    }

    // status 1 = waiting, 2 = pending
    await sleep(config.sms.pollIntervalMs);
  }

  console.log(`[SMSPool:${tag}] Timed out waiting for SMS`);
  return null;
}

/**
 * Cancel an SMS order.
 */
async function cancelOrder(orderId) {
  try {
    await fetch(`${API}/sms/cancel?key=${API_KEY}&orderid=${orderId}`);
  } catch { /* best effort */ }
}

module.exports = {
  getBalance,
  getCountries,
  getServices,
  findRobloxServiceId,
  purchaseNumber,
  waitForCode,
  cancelOrder,
};
