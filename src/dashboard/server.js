/**
 * Divine Cinema Command Center — Express.js + Socket.IO (Phase 2).
 *
 * Features:
 *   - Live 2D heatmap of all 100 agents (color = emotion)
 *   - GDP Ticker & Gini Coefficient
 *   - Reputation Web (D3.js force graph)
 *   - Soul Window (click any agent for neural stream, trust scores, secret goals)
 *   - God Console (lightning, spawn items, whisper, answer prayers)
 *   - Prayer Notification system
 *   - Lore Keeper (auto-generated world history)
 *   - Guild & Caste overview
 *   - Justice system viewer
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const { getGossipLedger } = require('../social/gossip');
const { getPantheon } = require('../social/religion');

function createDashboard(botManager, eventBus, systems) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── REST API ──────────────────────────────────────────────────────────

  app.get('/api/agents', (req, res) => {
    res.json(botManager.getAllAgents());
  });

  app.get('/api/agents/:id', (req, res) => {
    const agent = botManager.getAgent(parseInt(req.params.id, 10));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const guild = systems?.guilds ? systems.guilds.getGuild(agent.soul.id) : null;
    const wealth = systems?.bank ? systems.bank.getAgentWealth(agent.soul.id) : null;
    res.json({
      id: agent.soul.id,
      name: agent.soul.name,
      archetype: agent.soul.archetype,
      backstory: agent.soul.backstory,
      traits: agent.soul.traits,
      speechStyle: agent.soul.speechStyle,
      guild: guild?.name || 'Unassigned',
      wealth: wealth || { balance: 0, percentile: 0 },
      needs: agent.state.needs,
      position: agent.bot?.entity?.position
        ? { x: Math.floor(agent.bot.entity.position.x), y: Math.floor(agent.bot.entity.position.y), z: Math.floor(agent.bot.entity.position.z) }
        : null,
      health: agent.bot?.health || 0,
      isJailed: systems?.justice ? systems.justice.isJailed(agent.soul.id) : false,
    });
  });

  app.get('/api/souls', (req, res) => {
    const souls = botManager.souls || [];
    res.json(souls);
  });

  app.get('/api/gossip', (req, res) => {
    res.json(getGossipLedger());
  });

  app.get('/api/religion', (req, res) => {
    res.json(getPantheon());
  });

  // ── Phase 2 Endpoints ──────────────────────────────────────────────

  app.get('/api/economy', (req, res) => {
    res.json(systems?.bank ? systems.bank.getStatus() : {});
  });

  app.get('/api/guilds', (req, res) => {
    res.json(systems?.guilds ? systems.guilds.getStatus() : {});
  });

  app.get('/api/justice', (req, res) => {
    res.json(systems?.justice ? systems.justice.getStatus() : {});
  });

  app.get('/api/prayers', (req, res) => {
    res.json(systems?.prayers ? systems.prayers.getStatus() : {});
  });

  app.get('/api/lore', (req, res) => {
    res.json(systems?.loreKeeper ? systems.loreKeeper.getChapters() : []);
  });

  // ── God Console Actions ───────────────────────────────────────────────

  app.post('/api/god/lightning', (req, res) => {
    const agentId = req.body.agentId !== undefined ? parseInt(req.body.agentId, 10) : undefined;
    if (agentId !== undefined) {
      botManager.strikeLightning(agentId);
      res.json({ ok: true, action: 'lightning', agentId });
    } else {
      const agents = botManager.getAllAgents();
      if (agents.length > 0) {
        const target = agents[Math.floor(Math.random() * agents.length)];
        botManager.strikeLightning(target.id);
        res.json({ ok: true, action: 'lightning', agentId: target.id });
      } else {
        res.status(400).json({ error: 'No agents online' });
      }
    }
  });

  app.post('/api/god/spawn-item', (req, res) => {
    const { item } = req.body;
    const agentId = req.body.agentId !== undefined ? parseInt(req.body.agentId, 10) : undefined;
    if (agentId === undefined || !item) return res.status(400).json({ error: 'agentId and item required' });
    botManager.spawnItem(agentId, item);
    res.json({ ok: true, action: 'spawn-item', agentId, item });
  });

  app.post('/api/god/whisper', (req, res) => {
    const { message } = req.body;
    const agentId = req.body.agentId !== undefined ? parseInt(req.body.agentId, 10) : undefined;
    if (agentId === undefined || !message) return res.status(400).json({ error: 'agentId and message required' });
    botManager.whisper(agentId, message);
    res.json({ ok: true, action: 'whisper', agentId, message });
  });

  app.post('/api/god/broadcast', (req, res) => {
    const { event } = req.body;
    if (!event) return res.status(400).json({ error: 'event required' });
    botManager.sendGodEventToAll(event);
    res.json({ ok: true, action: 'broadcast', event });
  });

  app.post('/api/god/answer-prayer', (req, res) => {
    const { prayerId, response } = req.body;
    if (prayerId === undefined || !response) return res.status(400).json({ error: 'prayerId and response required' });
    const prayer = systems?.prayers ? systems.prayers.answerPrayer(prayerId, response) : null;
    if (!prayer) return res.status(404).json({ error: 'Prayer not found' });
    if (prayer.agentId !== undefined) {
      botManager.whisper(prayer.agentId, `The divine answers your prayer: "${response}"`);
    }
    res.json({ ok: true, prayer });
  });

  app.post('/api/god/inject-emeralds', (req, res) => {
    const { amount } = req.body;
    const agentId = req.body.agentId !== undefined ? parseInt(req.body.agentId, 10) : undefined;
    if (agentId === undefined || !amount) return res.status(400).json({ error: 'agentId and amount required' });
    if (systems?.bank) {
      systems.bank.injectEmeralds(agentId, amount);
      botManager.sendGodEvent(agentId, `${amount} emeralds materialized out of thin air!`);
    }
    res.json({ ok: true, action: 'inject-emeralds', agentId, amount });
  });

  app.post('/api/lore/generate', async (req, res) => {
    if (!systems?.loreKeeper) return res.status(500).json({ error: 'Lore keeper not initialized' });
    const chapter = await systems.loreKeeper.generateChapter();
    res.json(chapter || { error: 'Not enough events to generate a chapter' });
  });

  // ── Socket.IO ─────────────────────────────────────────────────────────

  io.on('connection', (socket) => {
    console.log('[Dashboard] Client connected');
    socket.emit('agents:list', botManager.getAllAgents());

    // Send current system state
    if (systems?.bank) socket.emit('economy:snapshot', systems.bank.getStatus());
    if (systems?.guilds) socket.emit('guilds:status', systems.guilds.getStatus());
    if (systems?.justice) socket.emit('justice:status', systems.justice.getStatus());
    if (systems?.prayers) socket.emit('prayers:status', systems.prayers.getStatus());

    socket.on('disconnect', () => {
      console.log('[Dashboard] Client disconnected');
    });
  });

  // Forward all events to dashboard
  const forwardEvents = [
    'agent:tick', 'agent:spawn', 'agent:despawn',
    'gossip:spread', 'god:event', 'god:whisper', 'manager:ready',
    'economy:transfer', 'economy:scam', 'economy:gdp_snapshot', 'economy:injection',
    'justice:bounty', 'justice:arrest', 'justice:trial', 'justice:jailed',
    'prayer:received', 'prayer:answered',
    'guilds:new_role', 'lore:chapter',
  ];

  for (const evt of forwardEvents) {
    eventBus.on(evt, (data) => io.emit(evt, data));
  }

  // ── Start ─────────────────────────────────────────────────────────────

  function start() {
    return new Promise((resolve) => {
      server.listen(config.dashboard.port, '0.0.0.0', () => {
        console.log(`[Dashboard] Divine Cinema Command Center at http://0.0.0.0:${config.dashboard.port}`);
        resolve(server);
      });
    });
  }

  return { app, server, io, start };
}

module.exports = { createDashboard };
