/**
 * Mirror — Discord Bot (Multi-Channel)
 *
 * 3+ people can run pipelines simultaneously in different channels.
 * Each channel gets its own independent pipeline with clean embeds.
 *
 * Commands:
 *   /mirror start [keyword] [threads]  — start autonomous pipeline
 *   /mirror stop                       — stop this channel's run
 *   /mirror stats                      — view dashboard
 *   /mirror status                     — check all running pipelines
 *
 * Made by Devin & Metro
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  startAutonomous,
  stopAutonomous,
  isRunning,
  getCurrentCycle,
  setCycleCallback,
  setAlertCallback,
  getAvailableAccounts,
  getRunningPipelines,
} = require('./autonomous');
const { loadStats, getRemainingUploads, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { loadAccounts } = require('./c1');

const BOT_TOKEN = process.env.MIRROR_BOT_TOKEN || '';

// ── Colors ───────────────────────────────────────────────────────────

const C = {
  brand:   0x8b5cf6, // Vibrant purple
  success: 0x10b981, // Emerald green
  danger:  0xef4444, // Red
  warn:    0xf59e0b, // Amber
  info:    0x6366f1, // Indigo
  muted:   0x4b5563, // Gray
  accent:  0x06b6d4, // Cyan
};

// ── Bot Setup ────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ── Slash Commands ───────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('mirror')
    .setDescription('Mirror — Roblox Model Pipeline')
    .addSubcommand((sub) =>
      sub.setName('start')
        .setDescription('Start the fully automatic pipeline')
        .addStringOption((opt) =>
          opt.setName('keyword').setDescription('Type . for popular, or enter a keyword').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('threads').setDescription('Upload threads (default: 15)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop this channel\'s pipeline')
    )
    .addSubcommand((sub) =>
      sub.setName('stats').setDescription('View the dashboard')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('View all running pipelines')
    ),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map((c) => c.toJSON()) },
    );
    console.log('[Bot] Slash commands registered');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
}

// ── Embed Helpers ────────────────────────────────────────────────────

function progressBar(percent, length = 12) {
  const filled = Math.round((percent / 100) * length);
  return '▓'.repeat(filled) + '░'.repeat(length - filled);
}

function divider() {
  return '─────────────────────────────';
}

function uptime(startMs) {
  if (!startMs) return '0s';
  const diff = Date.now() - startMs;
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// ── Embed Builders ───────────────────────────────────────────────────

function embedStart(keyword, threads, user) {
  return new EmbedBuilder()
    .setColor(C.success)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### Pipeline Activated\n` +
      `${divider()}\n` +
      `> **Keyword** \`${keyword}\`\n` +
      `> **Threads** \`${threads}\`\n` +
      `> **Mode** \`Fully Automatic\`\n` +
      `${divider()}\n` +
      `\`\`\`\nGen → Grab → Title → Upload → Repeat\n\`\`\`\n` +
      `Started by **${user}** — use \`/mirror stop\` to halt`
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function embedCycle(summary) {
  const total = summary.modelsPublished + summary.modelsFailed;
  const rate = total > 0 ? Math.round((summary.modelsPublished / total) * 100) : 100;
  const bar = progressBar(rate);
  const color = rate >= 80 ? C.success : rate >= 50 ? C.warn : C.danger;

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### Cycle #${summary.cycle}\n` +
      `${divider()}\n\n` +
      `**${summary.modelsPublished}** uploaded  ·  **${summary.modelsFailed}** failed  ·  **${summary.duration}**\n\n` +
      `\`${bar}\` **${rate}%** success\n\n` +
      `${divider()}\n` +
      `> Grabbed \`${summary.modelsDownloaded}\` · Titled \`${summary.modelsTitled}\` · Accounts \`${summary.accountsUsed}\``
    )
    .setFooter({ text: `Mirror by Devin & Metro • ${summary.keyword || 'popular'}` })
    .setTimestamp();
}

function embedStats(stats, accounts) {
  const uploaded = stats.totalModelsUploaded || 0;
  const failed = stats.totalModelsFailed || 0;
  const rate = uploaded + failed > 0 ? Math.round((uploaded / (uploaded + failed)) * 100) : 0;
  const sessions = (stats.sessions || []).length;
  const bar = progressBar(rate);

  const embed = new EmbedBuilder()
    .setColor(C.brand)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### Dashboard\n` +
      `${divider()}\n\n` +
      `**Models**\n` +
      `> Uploaded \`${uploaded}\` · Failed \`${failed}\` · Downloaded \`${stats.totalModelsDownloaded || 0}\`\n` +
      `> \`${bar}\` **${rate}%** success rate\n\n` +
      `**Overview**\n` +
      `> Accounts \`${stats.totalAccountsCreated || 0}\` · Sessions \`${sessions}\`\n\n` +
      `${divider()}`
    );

  // Accounts
  if (accounts.length > 0) {
    const lines = accounts.slice(-8).map((a) => {
      const ups = (stats.accountUploads && stats.accountUploads[a.username]) || 0;
      const pct = Math.round((ups / MODEL_CAP_PER_ACCOUNT) * 100);
      const bar = progressBar(pct, 8);
      const tag = ups >= MODEL_CAP_PER_ACCOUNT ? '`FULL`' : `\`${MODEL_CAP_PER_ACCOUNT - ups} left\``;
      return `\`${bar}\` **${a.username}** — ${ups}/200 ${tag}`;
    });
    embed.addFields({ name: '🔑 Accounts', value: lines.join('\n') });
  }

  // Recent uploads
  const recent = (stats.uploads || []).slice(-5).reverse();
  if (recent.length > 0) {
    const lines = recent.map((u) => {
      const dot = u.success ? '`🟢`' : '`🔴`';
      const title = (u.title || 'Untitled').slice(0, 28);
      const ts = u.timestamp ? `<t:${Math.floor(new Date(u.timestamp).getTime() / 1000)}:R>` : '';
      return `${dot} ${title} ${ts}`;
    });
    embed.addFields({ name: '📋 Recent', value: lines.join('\n') });
  }

  // Running pipelines
  const running = getRunningPipelines();
  if (running.length > 0) {
    const lines = running.map((p) => {
      return `> \`#${p.cycle}\` **${p.keyword || 'popular'}** — ${uptime(p.startedAt)} — by ${p.startedBy}`;
    });
    embed.addFields({ name: '⚡ Active Pipelines', value: lines.join('\n') });
  } else {
    embed.addFields({ name: '⚡ Status', value: '`Idle` — use `/mirror start` to begin' });
  }

  embed.setFooter({ text: 'Mirror by Devin & Metro' }).setTimestamp();
  return embed;
}

function embedStatus() {
  const running = getRunningPipelines();
  const available = getAvailableAccounts();
  let totalCapacity = 0;
  for (const a of available) totalCapacity += getRemainingUploads(a.username);

  if (running.length === 0) {
    return new EmbedBuilder()
      .setColor(C.muted)
      .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
      .setDescription(
        `### Idle\n` +
        `${divider()}\n\n` +
        `No pipelines running.\n` +
        `Use \`/mirror start\` to begin.\n\n` +
        `> **${available.length}** accounts available · **${totalCapacity}** upload capacity`
      )
      .setFooter({ text: 'Mirror by Devin & Metro' })
      .setTimestamp();
  }

  const lines = running.map((p, i) => {
    return `> **${i + 1}.** \`${p.keyword || 'popular'}\` — Cycle #${p.cycle} — ${uptime(p.startedAt)} — <#${p.channelId}>`;
  });

  return new EmbedBuilder()
    .setColor(C.success)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### ${running.length} Pipeline${running.length > 1 ? 's' : ''} Running\n` +
      `${divider()}\n\n` +
      lines.join('\n') + '\n\n' +
      `${divider()}\n` +
      `> **${available.length}** accounts · **${totalCapacity}** capacity remaining\n` +
      `> Use \`/mirror stop\` in a channel to halt its pipeline`
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function embedAlert(type, msg) {
  const colors = { critical: C.danger, error: C.danger, warning: C.warn, accounts: C.info, info: C.muted };
  const icons = { critical: '🚨', error: '❌', warning: '⚠️', accounts: '👤', info: 'ℹ️' };

  return new EmbedBuilder()
    .setColor(colors[type] || C.brand)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### ${icons[type] || '⚠️'} ${type.charAt(0).toUpperCase() + type.slice(1)}\n` +
      `${divider()}\n\n${msg}`
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function embedStopping() {
  return new EmbedBuilder()
    .setColor(C.warn)
    .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setDescription(
      `### Stopping\n` +
      `${divider()}\n\n` +
      `Pipeline will stop after the current cycle finishes.`
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

// ── Command Handlers ─────────────────────────────────────────────────

async function handleStart(interaction) {
  const channelId = interaction.channelId;

  if (isRunning(channelId)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(C.warn)
        .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
        .setDescription('Pipeline already running in this channel.\nUse `/mirror stop` first.')
        .setTimestamp()],
      ephemeral: true,
    });
  }

  let keyword = interaction.options.getString('keyword') || 'popular';
  if (keyword === '.' || keyword.toLowerCase() === 'popular') keyword = 'popular';
  const threads = interaction.options.getInteger('threads') || 15;
  const userName = interaction.user.displayName || interaction.user.username;

  await interaction.reply({ embeds: [embedStart(keyword, threads, userName)] });

  // Start pipeline for this channel
  const pipelineKeyword = (keyword === 'popular' || keyword === '.') ? '' : keyword;

  startAutonomous(channelId, {
    keyword: pipelineKeyword,
    modelsPerCycle: 50,
    threads,
    startedBy: userName,
  }).catch((err) => {
    interaction.channel.send({
      embeds: [embedAlert('critical', `Pipeline crashed: ${err.message}`)],
    }).catch(() => {});
  });

  // Wire up callbacks after pipeline is created
  setCycleCallback(channelId, async (summary) => {
    try {
      await interaction.channel.send({ embeds: [embedCycle(summary)] });
    } catch { /* ignore */ }
  });

  setAlertCallback(channelId, async (type, msg) => {
    try {
      await interaction.channel.send({ embeds: [embedAlert(type, msg)] });
    } catch { /* ignore */ }
  });
}

async function handleStop(interaction) {
  const channelId = interaction.channelId;

  if (!isRunning(channelId)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(C.muted)
        .setAuthor({ name: 'MIRROR', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
        .setDescription('No pipeline running in this channel.')
        .setTimestamp()],
      ephemeral: true,
    });
  }

  stopAutonomous(channelId);
  await interaction.reply({ embeds: [embedStopping()] });
}

async function handleStats(interaction) {
  const stats = loadStats();
  const accounts = loadAccounts();
  await interaction.reply({ embeds: [embedStats(stats, accounts)] });
}

async function handleStatus(interaction) {
  await interaction.reply({ embeds: [embedStatus()] });
}

// ── Event Handlers ───────────────────────────────────────────────────

client.once('clientReady', async () => {
  console.log('');
  console.log('  \x1b[35m╔═══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[32mMIRROR BOT ONLINE\x1b[0m                       \x1b[35m║\x1b[0m');
  console.log(`  \x1b[35m║\x1b[0m   \x1b[33m${client.user.tag}\x1b[0m`);
  console.log(`  \x1b[35m║\x1b[0m   Servers: \x1b[33m${client.guilds.cache.size}\x1b[0m`);
  console.log('  \x1b[35m║\x1b[0m   Made by Devin & Metro                   \x1b[35m║\x1b[0m');
  console.log('  \x1b[35m╚═══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'mirror') return;

  const sub = interaction.options.getSubcommand();
  try {
    switch (sub) {
      case 'start': return await handleStart(interaction);
      case 'stop': return await handleStop(interaction);
      case 'stats': return await handleStats(interaction);
      case 'status': return await handleStatus(interaction);
      default:
        return interaction.reply({ content: 'Unknown command', ephemeral: true });
    }
  } catch (err) {
    console.error('[Bot] Command error:', err);
    const reply = interaction.replied || interaction.deferred
      ? interaction.followUp.bind(interaction)
      : interaction.reply.bind(interaction);
    await reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
  }
});

// ── Health Check (for cloud hosts like Remoud/Railway that need a port) ──

const http = require('http');
const PORT = process.env.PORT || 8080;

function startHealthCheck() {
  http.createServer((req, res) => {
    const running = getRunningPipelines();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      bot: client.user ? client.user.tag : 'connecting...',
      pipelines: running.length,
      uptime: process.uptime(),
    }));
  }).listen(PORT, () => {
    console.log(`[Bot] Health check on :${PORT}`);
  });
}

// ── Start ────────────────────────────────────────────────────────────

function startBot() {
  if (!BOT_TOKEN) {
    console.error('[Bot] MIRROR_BOT_TOKEN not set');
    process.exit(1);
  }
  startHealthCheck();
  console.log('[Bot] Connecting to Discord...');
  client.login(BOT_TOKEN).catch((err) => {
    console.error('[Bot] Login failed:', err.message);
    process.exit(1);
  });
}

if (require.main === module) {
  startBot();
}

module.exports = { startBot, client };
