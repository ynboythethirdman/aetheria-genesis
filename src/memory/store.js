/**
 * Memory Store — Upstash Redis-backed agent memory.
 *
 * Each agent stores:
 *   - Short-term memories (recent observations, capped ring buffer)
 *   - Relationships (opinion scores about other agents)
 *   - Beliefs (cultural / religious ideas they hold)
 *   - Gossip log (rumors they've heard)
 *
 * Falls back to in-memory Maps when Redis is not configured.
 */

const config = require('../config');

let Redis;
try {
  Redis = require('ioredis');
} catch {
  Redis = null;
}

const MAX_MEMORIES = 50;
const MAX_GOSSIP = 30;

// ── In-memory fallback ──────────────────────────────────────────────────
const localStore = new Map();

function localKey(agentId, field) {
  return `agent:${agentId}:${field}`;
}

function getLocal(key, fallback) {
  return localStore.get(key) ?? fallback;
}

function setLocal(key, value) {
  localStore.set(key, value);
}

// ── Redis client (lazy init) ────────────────────────────────────────────
let redis = null;
let redisConnected = false;
let redisFailed = false;
const REDIS_RETRY_AFTER = 60000;
let redisFailedAt = 0;

function getRedis() {
  if (redis && redisConnected) return redis;
  if (redisFailed) {
    if (Date.now() - redisFailedAt < REDIS_RETRY_AFTER) return null;
    redisFailed = false;
  }
  if (!config.redis.url || !Redis) return null;
  if (redis) return null; // Connection in progress, use fallback until ready
  // Upstash requires TLS — upgrade redis:// to rediss:// if needed
  let redisUrl = config.redis.url;
  if (redisUrl.includes('upstash.io') && redisUrl.startsWith('redis://')) {
    redisUrl = redisUrl.replace('redis://', 'rediss://');
  }
  const client = new Redis(redisUrl, {
    password: config.redis.token || undefined,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  redis = client;
  client.connect().then(() => {
    redisConnected = true;
    console.log('[Memory] Redis connected successfully');
  }).catch((err) => {
    console.error('[Memory] Redis connection failed, using in-memory fallback:', err.message);
    try { client.disconnect(); } catch { /* ignore */ }
    redis = null;
    redisConnected = false;
    redisFailed = true;
    redisFailedAt = Date.now();
  });
  return null; // Return null until connection is confirmed
}

// ── Public API ──────────────────────────────────────────────────────────

async function addMemory(agentId, memory) {
  const r = getRedis();
  const key = localKey(agentId, 'memories');
  if (r) {
    await r.lpush(key, JSON.stringify(memory));
    await r.ltrim(key, 0, MAX_MEMORIES - 1);
  } else {
    const arr = getLocal(key, []);
    arr.unshift(memory);
    if (arr.length > MAX_MEMORIES) arr.pop();
    setLocal(key, arr);
  }
}

async function getMemories(agentId, count = 10) {
  const r = getRedis();
  const key = localKey(agentId, 'memories');
  if (r) {
    const raw = await r.lrange(key, 0, count - 1);
    return raw.map((s) => JSON.parse(s));
  }
  return (getLocal(key, [])).slice(0, count);
}

async function setRelationship(agentId, targetId, score, notes) {
  const r = getRedis();
  const key = localKey(agentId, 'relationships');
  const data = { targetId, score, notes, updatedAt: Date.now() };
  if (r) {
    await r.hset(key, String(targetId), JSON.stringify(data));
  } else {
    const map = getLocal(key, {});
    map[targetId] = data;
    setLocal(key, map);
  }
}

async function getRelationship(agentId, targetId) {
  const r = getRedis();
  const key = localKey(agentId, 'relationships');
  if (r) {
    const raw = await r.hget(key, String(targetId));
    return raw ? JSON.parse(raw) : null;
  }
  const map = getLocal(key, {});
  return map[targetId] || null;
}

async function getAllRelationships(agentId) {
  const r = getRedis();
  const key = localKey(agentId, 'relationships');
  if (r) {
    const raw = await r.hgetall(key);
    const result = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = JSON.parse(v);
    }
    return result;
  }
  return getLocal(key, {});
}

async function addBelief(agentId, belief) {
  const r = getRedis();
  const key = localKey(agentId, 'beliefs');
  if (r) {
    await r.hset(key, belief.idea, JSON.stringify(belief));
  } else {
    const set = getLocal(key, []);
    const existingIndex = set.findIndex((b) => b.idea === belief.idea);
    if (existingIndex >= 0) {
      set[existingIndex] = belief;
    } else {
      set.push(belief);
    }
    setLocal(key, set);
  }
}

async function getBeliefs(agentId) {
  const r = getRedis();
  const key = localKey(agentId, 'beliefs');
  if (r) {
    const raw = await r.hgetall(key);
    return Object.values(raw).map((s) => JSON.parse(s));
  }
  return getLocal(key, []);
}

async function addGossip(agentId, gossip) {
  const r = getRedis();
  const key = localKey(agentId, 'gossip');
  if (r) {
    await r.lpush(key, JSON.stringify(gossip));
    await r.ltrim(key, 0, MAX_GOSSIP - 1);
  } else {
    const arr = getLocal(key, []);
    arr.unshift(gossip);
    if (arr.length > MAX_GOSSIP) arr.pop();
    setLocal(key, arr);
  }
}

async function getGossip(agentId, count = 5) {
  const r = getRedis();
  const key = localKey(agentId, 'gossip');
  if (r) {
    const raw = await r.lrange(key, 0, count - 1);
    return raw.map((s) => JSON.parse(s));
  }
  return (getLocal(key, [])).slice(0, count);
}

module.exports = {
  addMemory,
  getMemories,
  setRelationship,
  getRelationship,
  getAllRelationships,
  addBelief,
  getBeliefs,
  addGossip,
  getGossip,
};
