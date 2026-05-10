/**
 * Aetheria Genesis — Main Entry Point (Phase 2)
 *
 * Orchestrates all subsystems:
 *   1. Soul generation (100 unique agent profiles)
 *   2. Phase 2 systems: Guilds, Economics, Justice, Prayers, Lore
 *   3. Dashboard launch (Express + Socket.IO)
 *   4. Bot fleet spawn (staggered Mineflayer connections)
 *   5. Periodic GDP snapshots and lore generation
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { generateAllSouls } = require('./agents/generateSouls');
const BotManager = require('./bot/manager');
const { createDashboard } = require('./dashboard/server');
const { GuildSystem } = require('./systems/guilds');
const { TownBank } = require('./economy/bank');
const { JusticeSystem } = require('./justice/court');
const { PrayerSystem } = require('./systems/prayers');
const { LoreKeeper } = require('./systems/loreKeeper');

// Increase listener limit for 100+ agents
EventEmitter.defaultMaxListeners = 200;

async function main() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║        AETHERIA GENESIS v2.0.0            ║');
  console.log('  ║   100-Agent Autonomous Civilization       ║');
  console.log('  ║   Phase 2: Economics, Justice, Guilds     ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');

  // ── 1. Generate or load souls ──────────────────────────────────────
  const soulsPath = path.join(__dirname, 'agents', 'souls.json');
  let souls;

  if (fs.existsSync(soulsPath)) {
    console.log('[Genesis] Loading existing souls from souls.json...');
    souls = JSON.parse(fs.readFileSync(soulsPath, 'utf-8'));
  } else {
    console.log(`[Genesis] Generating ${config.agents.count} unique souls...`);
    souls = generateAllSouls(config.agents.count);
    fs.writeFileSync(soulsPath, JSON.stringify(souls, null, 2));
    console.log(`[Genesis] Saved ${souls.length} souls to ${soulsPath}`);
  }

  // ── 2. Create event bus ────────────────────────────────────────────
  const eventBus = new EventEmitter();

  // ── 3. Initialize Phase 2 systems ──────────────────────────────────
  console.log('[Genesis] Initializing Phase 2 systems...');

  const guilds = new GuildSystem();
  const bank = new TownBank(eventBus);
  const justice = new JusticeSystem(eventBus);
  const prayers = new PrayerSystem(eventBus);
  const loreKeeper = new LoreKeeper(eventBus);

  // Build name→id lookup for trade/scam target resolution
  const nameToId = new Map();
  for (const soul of souls) {
    nameToId.set(soul.name, soul.id);
    nameToId.set(soul.username, soul.id);
  }

  const systems = { guilds, bank, justice, prayers, loreKeeper, nameToId };

  // Pre-assign guilds and wallets for all souls
  for (const soul of souls) {
    guilds.assignGuild(soul.id, soul);
    const startingWealth = Math.floor(5 + soul.traits.greed * 15 + Math.random() * 10);
    bank.initWallet(soul.id, startingWealth);
  }

  console.log(`[Genesis] Guilds assigned: ${JSON.stringify(guilds.getStatus().guildCounts)}`);
  console.log(`[Genesis] Economy initialized: ${bank.wallets.size} wallets`);

  // ── 4. Create bot manager ─────────────────────────────────────────
  const activeSouls = souls.slice(0, config.agents.count);
  const botManager = new BotManager(activeSouls, eventBus, systems);

  // ── 5. Start dashboard ────────────────────────────────────────────
  const dashboard = createDashboard(botManager, eventBus, systems);
  await dashboard.start();
  console.log(`[Genesis] Dashboard: http://localhost:${config.dashboard.port}`);

  // ── 6. Periodic systems ────────────────────────────────────────────
  // GDP snapshot every 60 seconds
  setInterval(() => {
    bank.snapshotGDP();
  }, 60000);

  // Check for new inventable roles every 5 minutes
  setInterval(() => {
    const allAgents = botManager.getAllAgents();
    const worldState = {
      population: allAgents.length,
      povertyRate: allAgents.filter((a) => a.wealth < 5).length / Math.max(1, allAgents.length),
      crimeRate: justice.bounties.filter((b) => b.status === 'active').length / Math.max(1, allAgents.length),
      inequalityGini: bank.calculateGini(),
      averageRebellion: souls.reduce((s, so) => s + (so.traits.rebellion || 0.1), 0) / souls.length,
      averageHealth: allAgents.reduce((s, a) => s + (a.health || 20), 0) / Math.max(1, allAgents.length) / 20,
      factionCount: Object.keys(guilds.getStatus().guilds).length,
    };
    const newRoles = guilds.checkForNewRoles(worldState);
    if (newRoles.length > 0) {
      console.log(`[Genesis] New roles invented: ${newRoles.join(', ')}`);
      eventBus.emit('guilds:new_role', { roles: newRoles });
    }
  }, 300000);

  // Lore chapter generation check every 10 minutes
  setInterval(async () => {
    if (loreKeeper.shouldGenerateChapter()) {
      console.log('[Genesis] Generating lore chapter...');
      const chapter = await loreKeeper.generateChapter();
      if (chapter) {
        console.log(`[Genesis] Chapter "${chapter.title}" written.`);
      }
    }
  }, 600000);

  // Initial GDP snapshot
  bank.snapshotGDP();

  // ── Graceful shutdown (register before spawn to handle SIGINT during long spawn) ──
  async function shutdown() {
    console.log('\n[Genesis] Shutting down Aetheria...');
    await botManager.shutdown();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ── 7. Connect to Minecraft and spawn agents ──────────────────────
  if (!config.minecraft.host || config.minecraft.host === 'localhost') {
    console.log('');
    console.log('[Genesis] ⚠  No Minecraft server configured.');
    console.log('[Genesis]    Set MC_HOST environment variable to your server IP.');
    console.log('[Genesis]    Dashboard is running — agents will spawn once MC_HOST is set.');
    console.log('');
    return;
  }

  console.log(`[Genesis] Connecting to ${config.minecraft.host}:${config.minecraft.port}...`);
  console.log(`[Genesis] Spawning ${souls.length} agents with ${config.agents.spawnDelay}ms delay...`);

  try {
    await botManager.spawnAll();
  } catch (err) {
    console.error(`[Genesis] Fatal spawn error: ${err.message}`);
  }
}

main().catch((err) => {
  console.error('[Genesis] Fatal error:', err);
  process.exit(1);
});
