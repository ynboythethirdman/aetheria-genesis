/**
 * Divine Dashboard — Express.js server with Socket.IO for real-time updates.
 *
 * Features:
 *   - Live map of all 100 agents
 *   - Inner monologue feed (private thoughts)
 *   - God Console (lightning, spawn items, whisper)
 *   - Gossip network viewer
 *   - Religion/belief tracker
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('../config');
const { getGossipLedger } = require('../social/gossip');
const { getPantheon } = require('../social/religion');

function createDashboard(botManager, eventBus) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── REST API ──────────────────────────────────────────────────────────

  // Get all agents
  app.get('/api/agents', (req, res) => {
    res.json(botManager.getAllAgents());
  });

  // Get single agent details
  app.get('/api/agents/:id', (req, res) => {
    const agent = botManager.getAgent(parseInt(req.params.id, 10));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({
      id: agent.soul.id,
      name: agent.soul.name,
      archetype: agent.soul.archetype,
      backstory: agent.soul.backstory,
      traits: agent.soul.traits,
      speechStyle: agent.soul.speechStyle,
      position: agent.bot?.entity?.position
        ? {
            x: Math.floor(agent.bot.entity.position.x),
            y: Math.floor(agent.bot.entity.position.y),
            z: Math.floor(agent.bot.entity.position.z),
          }
        : null,
      health: agent.bot?.health || 0,
    });
  });

  // Get all souls (profiles)
  app.get('/api/souls', (req, res) => {
    const souls = botManager.souls || [];
    res.json(souls);
  });

  // Gossip ledger
  app.get('/api/gossip', (req, res) => {
    res.json(getGossipLedger());
  });

  // Religion/beliefs
  app.get('/api/religion', (req, res) => {
    res.json(getPantheon());
  });

  // ── God Console Actions ───────────────────────────────────────────────

  // Strike lightning near an agent
  app.post('/api/god/lightning', (req, res) => {
    const { agentId } = req.body;
    if (agentId !== undefined) {
      botManager.strikeLightning(agentId);
      res.json({ ok: true, action: 'lightning', agentId });
    } else {
      // Strike random agent
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

  // Spawn an item near an agent
  app.post('/api/god/spawn-item', (req, res) => {
    const { agentId, item } = req.body;
    if (agentId === undefined || !item) {
      return res.status(400).json({ error: 'agentId and item required' });
    }
    botManager.spawnItem(agentId, item);
    res.json({ ok: true, action: 'spawn-item', agentId, item });
  });

  // Whisper a divine message to an agent
  app.post('/api/god/whisper', (req, res) => {
    const { agentId, message } = req.body;
    if (agentId === undefined || !message) {
      return res.status(400).json({ error: 'agentId and message required' });
    }
    botManager.whisper(agentId, message);
    res.json({ ok: true, action: 'whisper', agentId, message });
  });

  // Broadcast a god event to all agents
  app.post('/api/god/broadcast', (req, res) => {
    const { event } = req.body;
    if (!event) return res.status(400).json({ error: 'event required' });
    botManager.sendGodEventToAll(event);
    res.json({ ok: true, action: 'broadcast', event });
  });

  // ── Socket.IO (real-time feeds) ───────────────────────────────────────

  io.on('connection', (socket) => {
    console.log('[Dashboard] Client connected');

    // Send current state
    socket.emit('agents:list', botManager.getAllAgents());

    socket.on('disconnect', () => {
      console.log('[Dashboard] Client disconnected');
    });
  });

  // Forward events to all connected dashboard clients
  eventBus.on('agent:tick', (data) => {
    io.emit('agent:tick', data);
  });

  eventBus.on('agent:spawn', (data) => {
    io.emit('agent:spawn', data);
  });

  eventBus.on('agent:despawn', (data) => {
    io.emit('agent:despawn', data);
  });

  eventBus.on('gossip:spread', (data) => {
    io.emit('gossip:spread', data);
  });

  eventBus.on('god:event', (data) => {
    io.emit('god:event', data);
  });

  eventBus.on('god:whisper', (data) => {
    io.emit('god:whisper', data);
  });

  eventBus.on('manager:ready', (data) => {
    io.emit('manager:ready', data);
  });

  // ── Start ─────────────────────────────────────────────────────────────

  function start() {
    return new Promise((resolve) => {
      server.listen(config.dashboard.port, '0.0.0.0', () => {
        console.log(`[Dashboard] Divine Dashboard running at http://0.0.0.0:${config.dashboard.port}`);
        resolve(server);
      });
    });
  }

  return { app, server, io, start };
}

module.exports = { createDashboard };
