/**
 * Aetheria Genesis — Main Entry Point
 *
 * Orchestrates:
 *   1. Soul generation (100 unique agent profiles)
 *   2. Dashboard launch (Express + Socket.IO)
 *   3. Bot fleet spawn (staggered Mineflayer connections)
 *
 * Designed to run headless in Replit or any Node.js environment.
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { generateAllSouls } = require('./agents/generateSouls');
const BotManager = require('./bot/manager');
const { createDashboard } = require('./dashboard/server');

// Increase listener limit for 100+ agents
EventEmitter.defaultMaxListeners = 200;

async function main() {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║        AETHERIA GENESIS v1.0.0            ║');
  console.log('  ║   100-Agent Autonomous Civilization       ║');
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

  // ── 3. Create bot manager ─────────────────────────────────────────
  const botManager = new BotManager(souls, eventBus);

  // ── 4. Start dashboard ────────────────────────────────────────────
  const dashboard = createDashboard(botManager, eventBus);
  await dashboard.start();
  console.log(`[Genesis] Dashboard: http://localhost:${config.dashboard.port}`);

  // ── 5. Connect to Minecraft and spawn agents ──────────────────────
  if (!config.minecraft.host || config.minecraft.host === 'localhost') {
    console.log('');
    console.log('[Genesis] ⚠  No Minecraft server configured.');
    console.log('[Genesis]    Set MC_HOST environment variable to your server IP.');
    console.log('[Genesis]    Dashboard is running — agents will spawn once MC_HOST is set.');
    console.log('');

    // Keep the process alive for the dashboard
    return;
  }

  console.log(`[Genesis] Connecting to ${config.minecraft.host}:${config.minecraft.port}...`);
  console.log(`[Genesis] Spawning ${souls.length} agents with ${config.agents.spawnDelay}ms delay...`);

  try {
    await botManager.spawnAll();
  } catch (err) {
    console.error(`[Genesis] Fatal spawn error: ${err.message}`);
  }

  // ── Graceful shutdown ──────────────────────────────────────────────
  async function shutdown() {
    console.log('\n[Genesis] Shutting down Aetheria...');
    await botManager.shutdown();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Genesis] Fatal error:', err);
  process.exit(1);
});
