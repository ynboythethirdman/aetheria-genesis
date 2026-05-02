/**
 * Vibe Squad — Dashboard Server
 *
 * Lightweight Express + Socket.IO dashboard for monitoring
 * the squad's activity in real-time.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('../config');

function createVibeSquadDashboard(eventBus) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  // Serve static dashboard
  app.use(express.static(path.join(__dirname, 'public')));

  // API endpoint for squad status
  app.get('/api/status', (req, res) => {
    res.json({ status: 'running', timestamp: Date.now() });
  });

  // Socket.IO for real-time updates
  io.on('connection', (socket) => {
    console.log('[Dashboard] Client connected');

    socket.on('disconnect', () => {
      console.log('[Dashboard] Client disconnected');
    });

    // Allow sending commands from dashboard
    socket.on('command', (data) => {
      if (eventBus) {
        eventBus.emit('dashboard:command', data);
      }
    });
  });

  // Forward events to connected clients
  if (eventBus) {
    eventBus.on('squad:mode_change', (data) => io.emit('mode_change', data));
    eventBus.on('squad:emote', (data) => io.emit('emote', data));
    eventBus.on('squad:chatty', (data) => io.emit('chatty', data));
    eventBus.on('squad:stealth', (data) => io.emit('stealth', data));
    eventBus.on('bot:chat', (data) => io.emit('bot_chat', data));
    eventBus.on('bot:move', (data) => io.emit('bot_move', data));
    eventBus.on('bot:kick', (data) => io.emit('bot_kick', data));
    eventBus.on('bot:error', (data) => io.emit('bot_error', data));
  }

  return {
    start: () => new Promise((resolve) => {
      server.listen(config.dashboard.port, () => {
        console.log(`[Dashboard] Vibe Squad Dashboard: http://localhost:${config.dashboard.port}`);
        resolve();
      });
    }),
    io,
    app,
  };
}

module.exports = { createVibeSquadDashboard };
