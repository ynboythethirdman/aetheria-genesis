/**
 * Mirror — Discord Webhook Notifications
 *
 * Sends clean embedded messages to a Discord channel whenever a model
 * is uploaded to Roblox. Each embed includes:
 *   - Model name + emoji
 *   - Asset ID (linked)
 *   - Thumbnail
 *   - Account used
 *   - Timestamp
 */

const config = require('./config');

const WEBHOOK_URL = config.discord.webhookUrl;

const EMBED_COLOR = 0x7c3aed; // Purple accent

/**
 * Send a Discord webhook embed for a published model.
 *
 * @param {object} options
 * @param {string} options.title - Model title (with emoji)
 * @param {number|string} options.assetId - Roblox asset ID
 * @param {string} options.account - Account username used
 * @param {string} [options.description] - Short description
 * @param {string} [options.tags] - SEO tags
 * @param {string} [options.status] - Upload status
 */
async function notifyModelUploaded(options) {
  if (!WEBHOOK_URL) return;

  const { title, assetId, account, description, tags, status } = options;

  const assetUrl = assetId ? `https://www.roblox.com/library/${assetId}` : null;
  const thumbnailUrl = assetId
    ? `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
    : null;

  // Fetch actual thumbnail URL from Roblox API
  let imageUrl = null;
  if (thumbnailUrl) {
    try {
      const resp = await fetch(thumbnailUrl);
      if (resp.ok) {
        const data = await resp.json();
        imageUrl = data.data?.[0]?.imageUrl || null;
      }
    } catch { /* ignore */ }
  }

  const embed = {
    title: title || 'Model Uploaded',
    url: assetUrl,
    color: EMBED_COLOR,
    fields: [
      {
        name: 'Asset ID',
        value: assetId ? `\`${assetId}\`` : 'Pending',
        inline: true,
      },
      {
        name: 'Account',
        value: `\`${account || 'Unknown'}\``,
        inline: true,
      },
      {
        name: 'Status',
        value: status || 'Uploaded',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Mirror by Devin & Metro',
    },
  };

  if (imageUrl) {
    embed.thumbnail = { url: imageUrl };
  }

  if (tags) {
    const shortTags = tags.split(',').slice(0, 8).map((t) => t.trim()).join(', ');
    embed.fields.push({
      name: 'Tags',
      value: shortTags,
      inline: false,
    });
  }

  const payload = {
    username: 'Mirror',
    avatar_url: 'https://i.imgur.com/7kJZfVP.png',
    embeds: [embed],
  };

  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      console.log(`[Discord] Webhook failed: ${resp.status}`);
    }
  } catch (err) {
    console.log(`[Discord] Webhook error: ${err.message}`);
  }
}

/**
 * Send a pipeline summary embed to Discord.
 *
 * @param {object} summary
 * @param {number} summary.accountsCreated
 * @param {number} summary.modelsDownloaded
 * @param {number} summary.modelsTitled
 * @param {number} summary.modelsPublished
 * @param {number} summary.modelsFailed
 * @param {string} summary.duration
 */
async function notifyPipelineSummary(summary) {
  if (!WEBHOOK_URL) return;

  const embed = {
    title: 'Train Pipeline Complete',
    color: 0x22c55e,
    fields: [
      { name: 'Accounts Created', value: `\`${summary.accountsCreated}\``, inline: true },
      { name: 'Models Downloaded', value: `\`${summary.modelsDownloaded}\``, inline: true },
      { name: 'Titles Generated', value: `\`${summary.modelsTitled}\``, inline: true },
      { name: 'Published', value: `\`${summary.modelsPublished}\``, inline: true },
      { name: 'Failed', value: `\`${summary.modelsFailed}\``, inline: true },
      { name: 'Duration', value: `\`${summary.duration}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Mirror by Devin & Metro',
    },
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Mirror',
        avatar_url: 'https://i.imgur.com/7kJZfVP.png',
        embeds: [embed],
      }),
    });
  } catch { /* ignore */ }
}

module.exports = { notifyModelUploaded, notifyPipelineSummary };
