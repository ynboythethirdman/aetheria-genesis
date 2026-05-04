/**
 * Mirror — Discord Bot
 *
 * Control Mirror from Discord (mobile-friendly).
 * Commands:
 *   /mirror start [keyword] [models] — start autonomous pipeline
 *   /mirror stop                     — stop current run
 *   /mirror stats                    — show dashboard
 *   /mirror status                   — check current run status
 *
 * Made by Devin & Metro
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('./config');
const {
  startAutonomous,
  stopAutonomous,
  isRunning,
  getCurrentCycle,
  setStatusCallback,
  setAlertCallback,
  getAvailableAccounts,
} = require('./autonomous');
const { loadStats, getRemainingUploads, MODEL_CAP_PER_ACCOUNT } = require('./stats');
const { loadAccounts } = require('./c1');

const BOT_TOKEN = process.env.MIRROR_BOT_TOKEN || '';

// ── Bot Setup ────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

let statusChannel = null;

// ── Slash Commands ───────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('mirror')
    .setDescription('Control the Mirror pipeline')
    .addSubcommand((sub) =>
      sub.setName('start')
        .setDescription('Start the autonomous pipeline')
        .addStringOption((opt) =>
          opt.setName('keyword').setDescription('Model search keyword (leave empty for popular)').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('models').setDescription('Models per cycle (default 50)').setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt.setName('delay').setDescription('Seconds between cycles (default 30)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('stop')
        .setDescription('Stop the current autonomous run')
    )
    .addSubcommand((sub) =>
      sub.setName('stats')
        .setDescription('Show the Mirror dashboard')
    )
    .addSubcommand((sub) =>
      sub.setName('status')
        .setDescription('Check current run status')
    ),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

  try {
    console.log('[Bot] Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map((c) => c.toJSON()) },
    );
    console.log('[Bot] Commands registered');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
}

// ── Command Handlers ─────────────────────────────────────────────────

async function handleStart(interaction) {
  if (isRunning()) {
    return interaction.reply({
      embeds: [makeEmbed('Already Running', 'The pipeline is already running. Use `/mirror stop` first.', 0xf59e0b)],
      ephemeral: true,
    });
  }

  const keyword = interaction.options.getString('keyword') || '';
  const models = interaction.options.getInteger('models') || 50;
  const delay = interaction.options.getInteger('delay') || 30;

  statusChannel = interaction.channel;

  await interaction.reply({
    embeds: [makeEmbed(
      'Pipeline Starting',
      `**Keyword**: ${keyword || '(popular models)'}\n**Models/cycle**: ${models}\n**Delay**: ${delay}s between cycles\n\nRunning autonomously — use \`/mirror stop\` to halt.`,
      0x22c55e,
    )],
  });

  // Wire up status + alert callbacks to post to Discord
  setStatusCallback(async (msg) => {
    if (!statusChannel) return;
    try {
      await statusChannel.send({
        embeds: [makeEmbed('Status', msg, 0x7c3aed)],
      });
    } catch { /* channel may be unavailable */ }
  });

  setAlertCallback(async (type, msg) => {
    if (!statusChannel) return;
    const colors = { critical: 0xef4444, error: 0xef4444, warning: 0xf59e0b, accounts: 0x3b82f6, info: 0x7c3aed };
    try {
      await statusChannel.send({
        embeds: [makeEmbed(`Alert: ${type.toUpperCase()}`, msg, colors[type] || 0x7c3aed)],
      });
    } catch { /* ignore */ }
  });

  // Start in background
  startAutonomous({
    keyword,
    modelsPerCycle: models,
    delayBetweenCycles: delay * 1000,
  }).catch((err) => {
    if (statusChannel) {
      statusChannel.send({
        embeds: [makeEmbed('Pipeline Crashed', err.message, 0xef4444)],
      }).catch(() => {});
    }
  });
}

async function handleStop(interaction) {
  if (!isRunning()) {
    return interaction.reply({
      embeds: [makeEmbed('Not Running', 'No pipeline is currently running.', 0xf59e0b)],
      ephemeral: true,
    });
  }

  stopAutonomous();
  await interaction.reply({
    embeds: [makeEmbed('Stopping', 'Pipeline will stop after current cycle completes.', 0xf59e0b)],
  });
}

async function handleStats(interaction) {
  const stats = loadStats();
  const accounts = loadAccounts();

  const accountLines = accounts.map((a) => {
    const uploads = (stats.accountUploads && stats.accountUploads[a.username]) || 0;
    const remaining = MODEL_CAP_PER_ACCOUNT - uploads;
    const status = remaining > 0 ? `${remaining} left` : 'FULL';
    const cookie = a.cookie ? 'yes' : 'no';
    return `\`${a.username}\` — ${uploads}/${MODEL_CAP_PER_ACCOUNT} (${status}) | cookie: ${cookie}`;
  });

  const recentUploads = (stats.uploads || []).slice(-5).reverse().map((u) => {
    const icon = u.success ? '🟢' : '🔴';
    const title = (u.title || '').slice(0, 35);
    return `${icon} ${title}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('Mirror Dashboard')
    .setColor(0x7c3aed)
    .addFields(
      { name: 'Accounts Created', value: String(stats.totalAccountsCreated || 0), inline: true },
      { name: 'Models Downloaded', value: String(stats.totalModelsDownloaded || 0), inline: true },
      { name: 'Models Uploaded', value: String(stats.totalModelsUploaded || 0), inline: true },
      { name: 'Upload Failures', value: String(stats.totalModelsFailed || 0), inline: true },
      { name: 'Sessions', value: String((stats.sessions || []).length), inline: true },
      { name: 'Running', value: isRunning() ? `Cycle #${getCurrentCycle()}` : 'No', inline: true },
    )
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();

  if (accountLines.length > 0) {
    embed.addFields({ name: 'Accounts', value: accountLines.join('\n').slice(0, 1024) || 'None' });
  }

  if (recentUploads.length > 0) {
    embed.addFields({ name: 'Recent Uploads', value: recentUploads.join('\n') || 'None' });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleStatus(interaction) {
  if (!isRunning()) {
    return interaction.reply({
      embeds: [makeEmbed('Idle', 'No pipeline running. Use `/mirror start` to begin.', 0x6b7280)],
      ephemeral: true,
    });
  }

  const available = getAvailableAccounts();
  let totalCapacity = 0;
  for (const a of available) totalCapacity += getRemainingUploads(a.username);

  await interaction.reply({
    embeds: [makeEmbed(
      'Running',
      `**Cycle**: #${getCurrentCycle()}\n**Available accounts**: ${available.length}\n**Total upload capacity**: ${totalCapacity} models\n\nUse \`/mirror stop\` to halt.`,
      0x22c55e,
    )],
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeEmbed(title, description, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: 'Mirror by Devin & Metro' })
    .setTimestamp();
}

// ── Event Handlers ───────────────────────────────────────────────────

client.once('ready', async () => {
  console.log('');
  console.log('  \x1b[35m╔═══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[35m║\x1b[0m   \x1b[1m\x1b[32mMIRROR BOT ONLINE\x1b[0m                       \x1b[35m║\x1b[0m');
  console.log(`  \x1b[35m║\x1b[0m   Logged in as \x1b[33m${client.user.tag}\x1b[0m`);
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

// If run directly
if (require.main === module) {
  startBot();
}

module.exports = { startBot, client };
