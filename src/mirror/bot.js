/**
 * Mirror — Discord Bot
 *
 * Control Mirror from Discord (mobile-friendly).
 * Commands:
 *   /mirror start [keyword] [threads]  — start autonomous pipeline
 *   /mirror stop                       — stop current run
 *   /mirror stats                      — show dashboard
 *   /mirror status                     — check current run status
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
} = require('./autonomous');
const { loadStats, getRemainingUploads, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { loadAccounts } = require('./c1');

const BOT_TOKEN = process.env.MIRROR_BOT_TOKEN || '';
const PURPLE = 0x7c3aed;
const GREEN = 0x22c55e;
const RED = 0xef4444;
const YELLOW = 0xf59e0b;
const GRAY = 0x374151;

// ── Bot Setup ────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let statusChannel = null;

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
          opt.setName('threads').setDescription('Upload threads per account (default: 15)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop the pipeline')
    )
    .addSubcommand((sub) =>
      sub.setName('stats').setDescription('View the dashboard')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check if running')
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

// ── Embed Builders ───────────────────────────────────────────────────

function buildStartEmbed(keyword, threads) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setTitle('Pipeline Started')
    .setDescription(
      '```\n' +
      'Gen → Grab → Title → Upload → Repeat\n' +
      '```'
    )
    .addFields(
      { name: 'Keyword', value: `\`${keyword}\``, inline: true },
      { name: 'Threads', value: `\`${threads}\``, inline: true },
      { name: 'Mode', value: '`Automatic`', inline: true },
    )
    .setFooter({ text: 'Mirror by Devin & Metro • /mirror stop to halt' })
    .setTimestamp();
}

function buildCycleEmbed(summary) {
  const successRate = summary.modelsPublished + summary.modelsFailed > 0
    ? Math.round((summary.modelsPublished / (summary.modelsPublished + summary.modelsFailed)) * 100)
    : 0;

  const color = summary.modelsFailed > summary.modelsPublished ? RED
    : summary.modelsFailed > 0 ? YELLOW : GREEN;

  const bar = buildProgressBar(successRate);

  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setTitle(`Cycle #${summary.cycle} Complete`)
    .addFields(
      { name: 'Uploaded', value: `\`${summary.modelsPublished}\``, inline: true },
      { name: 'Failed', value: `\`${summary.modelsFailed}\``, inline: true },
      { name: 'Duration', value: `\`${summary.duration}\``, inline: true },
      { name: 'Success Rate', value: `${bar} \`${successRate}%\``, inline: false },
      { name: 'Accounts Used', value: `\`${summary.accountsUsed}\``, inline: true },
      { name: 'Models Grabbed', value: `\`${summary.modelsDownloaded}\``, inline: true },
      { name: 'Titles Generated', value: `\`${summary.modelsTitled}\``, inline: true },
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function buildStatsEmbed(stats, accounts) {
  const totalUploads = stats.totalModelsUploaded || 0;
  const totalFails = stats.totalModelsFailed || 0;
  const totalRate = totalUploads + totalFails > 0
    ? Math.round((totalUploads / (totalUploads + totalFails)) * 100) : 0;

  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setTitle('Dashboard')
    .setDescription(
      '```\n' +
      `Uploaded    ${String(totalUploads).padStart(6)}  │  Failed     ${String(totalFails).padStart(6)}\n` +
      `Accounts    ${String(stats.totalAccountsCreated || 0).padStart(6)}  │  Downloaded ${String(stats.totalModelsDownloaded || 0).padStart(6)}\n` +
      `Success     ${String(totalRate + '%').padStart(6)}  │  Sessions   ${String((stats.sessions || []).length).padStart(6)}\n` +
      '```'
    );

  // Account list
  if (accounts.length > 0) {
    const lines = accounts.slice(-10).map((a) => {
      const uploads = (stats.accountUploads && stats.accountUploads[a.username]) || 0;
      const remaining = MODEL_CAP_PER_ACCOUNT - uploads;
      const bar = buildProgressBar(Math.round((uploads / MODEL_CAP_PER_ACCOUNT) * 100), 8);
      const status = remaining > 0 ? `${remaining} left` : '**FULL**';
      return `${bar} \`${a.username}\` — ${uploads}/200 (${status})`;
    });
    embed.addFields({ name: 'Accounts', value: lines.join('\n') || 'None' });
  }

  // Recent uploads
  const recent = (stats.uploads || []).slice(-5).reverse();
  if (recent.length > 0) {
    const lines = recent.map((u) => {
      const icon = u.success ? '🟢' : '🔴';
      const title = (u.title || '').slice(0, 30);
      const time = u.timestamp ? `<t:${Math.floor(new Date(u.timestamp).getTime() / 1000)}:R>` : '';
      return `${icon} ${title} ${time}`;
    });
    embed.addFields({ name: 'Recent', value: lines.join('\n') });
  }

  embed
    .addFields({
      name: 'Status',
      value: isRunning() ? `🟢 Running — Cycle #${getCurrentCycle()}` : '⚫ Idle',
    })
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();

  return embed;
}

function buildStatusEmbed(available, totalCapacity) {
  if (!isRunning()) {
    return new EmbedBuilder()
      .setColor(GRAY)
      .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
      .setTitle('Idle')
      .setDescription('No pipeline running.\nUse `/mirror start` to begin.')
      .setFooter({ text: 'Mirror by Devin & Metro' })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(GREEN)
    .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setTitle('Running')
    .addFields(
      { name: 'Cycle', value: `\`#${getCurrentCycle()}\``, inline: true },
      { name: 'Accounts', value: `\`${available.length}\``, inline: true },
      { name: 'Capacity', value: `\`${totalCapacity} models\``, inline: true },
    )
    .setDescription('Use `/mirror stop` to halt after current cycle.')
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function buildAlertEmbed(type, msg) {
  const colors = { critical: RED, error: RED, warning: YELLOW, accounts: PURPLE, info: GRAY };
  const icons = { critical: '🚨', error: '❌', warning: '⚠️', accounts: '👤', info: 'ℹ️' };

  return new EmbedBuilder()
    .setColor(colors[type] || PURPLE)
    .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
    .setTitle(`${icons[type] || '⚠️'} ${type.charAt(0).toUpperCase() + type.slice(1)}`)
    .setDescription(msg)
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

function buildProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return '`' + '█'.repeat(filled) + '░'.repeat(empty) + '`';
}

// ── Command Handlers ─────────────────────────────────────────────────

async function handleStart(interaction) {
  if (isRunning()) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(YELLOW)
        .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
        .setTitle('Already Running')
        .setDescription('Use `/mirror stop` first.')
        .setTimestamp()],
      ephemeral: true,
    });
  }

  let keyword = interaction.options.getString('keyword') || 'popular';
  if (keyword === '.' || keyword.toLowerCase() === 'popular') keyword = 'popular';
  const threads = interaction.options.getInteger('threads') || 15;

  statusChannel = interaction.channel;

  await interaction.reply({ embeds: [buildStartEmbed(keyword, threads)] });

  // Only send cycle summaries + alerts (no spam)
  setCycleCallback(async (summary) => {
    if (!statusChannel) return;
    try {
      await statusChannel.send({ embeds: [buildCycleEmbed(summary)] });
    } catch { /* ignore */ }
  });

  setAlertCallback(async (type, msg) => {
    if (!statusChannel) return;
    try {
      await statusChannel.send({ embeds: [buildAlertEmbed(type, msg)] });
    } catch { /* ignore */ }
  });

  // Start in background
  startAutonomous({
    keyword: (keyword === 'popular' || keyword === '.') ? '' : keyword,
    modelsPerCycle: 50,
    threads,
  }).catch((err) => {
    if (statusChannel) {
      statusChannel.send({
        embeds: [buildAlertEmbed('critical', `Pipeline crashed: ${err.message}`)],
      }).catch(() => {});
    }
  });
}

async function handleStop(interaction) {
  if (!isRunning()) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(GRAY)
        .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
        .setTitle('Not Running')
        .setDescription('Nothing to stop.')
        .setTimestamp()],
      ephemeral: true,
    });
  }

  stopAutonomous();
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(YELLOW)
      .setAuthor({ name: 'Mirror', iconURL: 'https://i.imgur.com/7kJZfVP.png' })
      .setTitle('Stopping')
      .setDescription('Pipeline will stop after current cycle.')
      .setFooter({ text: 'Mirror by Devin & Metro' })
      .setTimestamp()],
  });
}

async function handleStats(interaction) {
  const stats = loadStats();
  const accounts = loadAccounts();
  await interaction.reply({ embeds: [buildStatsEmbed(stats, accounts)] });
}

async function handleStatus(interaction) {
  const available = getAvailableAccounts();
  let totalCapacity = 0;
  for (const a of available) totalCapacity += getRemainingUploads(a.username);
  await interaction.reply({ embeds: [buildStatusEmbed(available, totalCapacity)] });
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
      case 'start': return handleStart(interaction);
      case 'stop': return handleStop(interaction);
      case 'stats': return handleStats(interaction);
      case 'status': return handleStatus(interaction);
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

// ── Start ────────────────────────────────────────────────────────────

function startBot() {
  if (!BOT_TOKEN) {
    console.error('[Bot] MIRROR_BOT_TOKEN not set');
    process.exit(1);
  }
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
