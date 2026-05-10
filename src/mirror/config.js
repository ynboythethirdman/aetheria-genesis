/**
 * Mirror — Configuration
 *
 * Settings for Roblox account generation with email + phone verification.
 */

const baseConfig = require('../config');

module.exports = {
  llm: baseConfig.llm,
  redis: baseConfig.redis,

  // Account generation
  account: {
    count: parseInt(process.env.MIRROR_ACCOUNT_COUNT || '1', 10),
    birthYear: parseInt(process.env.MIRROR_BIRTH_YEAR || '2003', 10),
    passwordLength: parseInt(process.env.MIRROR_PASSWORD_LENGTH || '14', 10),
  },

  // CAPTCHA
  captcha: {
    omoCaptchaKey: process.env.OMO_CAPTCHA_KEY || '',
    apiBase: 'https://api.omocaptcha.com/v2',
    pollIntervalMs: 3000,
    maxPollAttempts: 40,
  },

  // Mail.tm (free, no key required)
  mail: {
    apiBase: 'https://api.mail.tm',
    pollIntervalMs: parseInt(process.env.MAIL_POLL_MS || '5000', 10),
    maxPollAttempts: parseInt(process.env.MAIL_MAX_POLLS || '36', 10),
  },

  // SMSPool
  sms: {
    apiKey: process.env.SMSPOOL_API_KEY || '',
    apiBase: 'https://api.smspool.net',
    country: process.env.SMSPOOL_COUNTRY || '1',
    service: process.env.SMSPOOL_SERVICE || '',
    pollIntervalMs: parseInt(process.env.SMS_POLL_MS || '5000', 10),
    maxPollAttempts: parseInt(process.env.SMS_MAX_POLLS || '60', 10),
  },

  // Browser
  browser: {
    headless: process.env.MIRROR_HEADLESS === 'true',
  },

  // Groq AI (for B1 title generation)
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    apiBase: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },

  // Concurrency
  concurrency: {
    downloads: parseInt(process.env.MIRROR_DOWNLOAD_THREADS || '25', 10),
    titles: parseInt(process.env.MIRROR_TITLE_THREADS || '15', 10),
    uploads: parseInt(process.env.MIRROR_UPLOAD_THREADS || '15', 10),
  },

  // Discord
  discord: {
    webhookUrl: process.env.MIRROR_DISCORD_WEBHOOK || '',
    botToken: process.env.MIRROR_BOT_TOKEN || '',
  },

  // Output
  output: {
    accountsFile: process.env.MIRROR_ACCOUNTS_FILE || 'data/accounts.json',
    statsFile: process.env.MIRROR_STATS_FILE || 'data/mirror_stats.json',
  },
};
