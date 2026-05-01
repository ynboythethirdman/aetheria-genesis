/**
 * Bot Manager — Handles spawning, lifecycle, and coordination of 100 Mineflayer bots.
 *
 * Bots are spawned with staggered delays to avoid overwhelming the server.
 * Each bot runs its own cognitive tick on a configurable interval.
 */

const mineflayer = require('mineflayer');
const config = require('../config');
const { cognitiveTick } = require('../agents/cognition');
const { receiveGossip } = require('../social/gossip');

class BotManager {
  constructor(souls, eventBus) {
    this.souls = souls;
    this.eventBus = eventBus;
    this.agents = new Map(); // agentId → { soul, bot, state, tickTimer }
    this.isRunning = false;
  }

  async spawnAll() {
    this.isRunning = true;
    console.log(`[BotManager] Spawning ${this.souls.length} agents...`);

    for (let i = 0; i < this.souls.length; i++) {
      if (!this.isRunning) break;

      const soul = this.souls[i];
      try {
        await this.spawnAgent(soul);
        console.log(`[BotManager] Spawned ${soul.name} (${i + 1}/${this.souls.length})`);
      } catch (err) {
        console.error(`[BotManager] Failed to spawn ${soul.name}: ${err.message}`);
      }

      // Staggered spawn delay
      if (i < this.souls.length - 1) {
        await new Promise((r) => setTimeout(r, config.agents.spawnDelay));
      }
    }

    console.log(`[BotManager] All agents spawned. Active: ${this.agents.size}`);
    this.eventBus.emit('manager:ready', { count: this.agents.size });
  }

  async spawnAgent(soul) {
    const bot = mineflayer.createBot({
      host: config.minecraft.host,
      port: config.minecraft.port,
      username: soul.username,
      version: config.minecraft.version,
      hideErrors: true,
    });

    const agentState = {
      soul,
      recentChat: [],
      pendingGodEvent: null,
      isThinking: false,
      lastTick: 0,
    };

    // ── Event Handlers ──────────────────────────────────────────────
    bot.once('spawn', () => {
      this.eventBus.emit('agent:spawn', {
        agentId: soul.id,
        name: soul.name,
        position: bot.entity?.position
          ? { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
          : null,
      });

      // Start cognitive loop
      const timer = setInterval(async () => {
        if (agentState.isThinking || !this.isRunning) return;
        agentState.isThinking = true;
        try {
          await cognitiveTick(agentState, bot, this.eventBus);
        } catch (err) {
          console.error(`[Cognition] ${soul.name} tick error: ${err.message}`);
        }
        agentState.isThinking = false;
        agentState.lastTick = Date.now();
      }, config.agents.tickInterval);

      this.agents.set(soul.id, { soul, bot, state: agentState, tickTimer: timer });
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;

      // Store in recent chat buffer
      agentState.recentChat.push({
        sender: username,
        message,
        timestamp: Date.now(),
      });

      // Cap buffer
      if (agentState.recentChat.length > 10) {
        agentState.recentChat.shift();
      }

      // Check if this is gossip from another agent
      const senderAgent = this.findAgentByUsername(username);
      if (senderAgent) {
        receiveGossip(soul, senderAgent.soul.name, message).catch(() => {});
      }
    });

    bot.on('error', (err) => {
      console.error(`[Bot] ${soul.name} error: ${err.message}`);
    });

    bot.on('kicked', (reason) => {
      console.error(`[Bot] ${soul.name} kicked: ${reason}`);
      this.removeAgent(soul.id);
    });

    bot.on('end', () => {
      console.log(`[Bot] ${soul.name} disconnected.`);
      this.removeAgent(soul.id);
    });

    return bot;
  }

  findAgentByUsername(username) {
    for (const agent of this.agents.values()) {
      if (agent.soul.username === username) return agent;
    }
    return null;
  }

  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      clearInterval(agent.tickTimer);
      this.agents.delete(agentId);
      this.eventBus.emit('agent:despawn', { agentId });
    }
  }

  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  getAllAgents() {
    const result = [];
    for (const [id, agent] of this.agents) {
      result.push({
        id,
        name: agent.soul.name,
        archetype: agent.soul.archetype,
        position: agent.bot?.entity?.position
          ? {
              x: Math.floor(agent.bot.entity.position.x),
              y: Math.floor(agent.bot.entity.position.y),
              z: Math.floor(agent.bot.entity.position.z),
            }
          : null,
        health: agent.bot?.health || 0,
        isThinking: agent.state.isThinking,
      });
    }
    return result;
  }

  // ── God Powers ──────────────────────────────────────────────────────
  sendGodEvent(agentId, event) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.state.pendingGodEvent = event;
      this.eventBus.emit('god:event', { agentId, event });
    }
  }

  sendGodEventToAll(event) {
    for (const [id] of this.agents) {
      this.sendGodEvent(id, event);
    }
  }

  whisper(agentId, message) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.state.pendingGodEvent = `A divine voice whispers: "${message}"`;
      this.eventBus.emit('god:whisper', { agentId, message });
    }
  }

  strikeLightning(agentId) {
    const agent = this.agents.get(agentId);
    if (agent && agent.bot?.entity) {
      const pos = agent.bot.entity.position;
      agent.bot.chat(`/summon lightning_bolt ${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}`);
      this.sendGodEventToAll('Lightning struck from a clear sky!');
    }
  }

  spawnItem(agentId, itemName) {
    const agent = this.agents.get(agentId);
    if (agent && agent.bot?.entity) {
      const pos = agent.bot.entity.position;
      agent.bot.chat(`/give ${agent.soul.username} ${itemName} 1`);
      this.sendGodEvent(agentId, `A ${itemName} materialized out of thin air!`);
    }
  }

  async shutdown() {
    this.isRunning = false;
    console.log('[BotManager] Shutting down...');
    for (const [id, agent] of this.agents) {
      clearInterval(agent.tickTimer);
      try {
        agent.bot.quit();
      } catch {
        // Already disconnected
      }
    }
    this.agents.clear();
    console.log('[BotManager] All agents disconnected.');
  }
}

module.exports = BotManager;
