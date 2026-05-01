/**
 * Gossip System — Information spreads from agent to agent via chat.
 *
 * When an agent gossips, the rumor is:
 *   1. Stored in the gossiper's memory
 *   2. Broadcast to nearby agents (they pick it up via chat listener)
 *   3. Potentially distorted based on the gossiper's traits
 *
 * Rumors decay over time and can mutate as they pass between agents.
 */

const memory = require('../memory/store');
const config = require('../config');

// Global gossip ledger for tracking spread
const gossipLedger = [];

function distortRumor(rumor, soul) {
  // Agents with high creativity may embellish
  if (soul.traits.creativity > 0.7 && Math.random() < 0.3) {
    const embellishments = [
      'I heard it was even worse than that — ',
      'And apparently, ',
      'Some say that also ',
      'The truth is even stranger: ',
    ];
    return embellishments[Math.floor(Math.random() * embellishments.length)] + rumor;
  }

  // Agents with low loyalty may twist the story
  if (soul.traits.loyalty < 0.3 && Math.random() < 0.4) {
    return rumor.replace(/good/gi, 'suspicious').replace(/helped/gi, 'manipulated');
  }

  return rumor;
}

async function spreadGossip(soul, rumor, targetName, eventBus) {
  const distorted = distortRumor(rumor, soul);

  // Store in gossiper's memory
  await memory.addGossip(soul.id, {
    from: soul.name,
    rumor: distorted,
    about: targetName || 'unknown',
    timestamp: Date.now(),
    original: rumor !== distorted,
  });

  // Add to global ledger
  const entry = {
    id: gossipLedger.length,
    source: soul.name,
    sourceId: soul.id,
    rumor: distorted,
    about: targetName || 'unknown',
    timestamp: Date.now(),
    spreadTo: [],
  };
  gossipLedger.push(entry);

  // Emit for dashboard
  if (eventBus) {
    eventBus.emit('gossip:spread', entry);
  }

  return entry;
}

async function receiveGossip(receiverSoul, senderName, rumor) {
  const shouldBelieve = Math.random() < (0.5 + receiverSoul.traits.superstition * 0.3);

  await memory.addGossip(receiverSoul.id, {
    from: senderName,
    rumor,
    timestamp: Date.now(),
    believed: shouldBelieve,
  });

  // Superstitious agents may form beliefs from gossip
  if (shouldBelieve && receiverSoul.traits.superstition > 0.6) {
    const conviction = Math.round(receiverSoul.traits.superstition * 100) / 100;
    await memory.addBelief(receiverSoul.id, {
      idea: rumor,
      source: senderName,
      conviction,
      formedAt: Date.now(),
    });
  }

  return shouldBelieve;
}

function getGossipLedger() {
  return gossipLedger.slice(-100);
}

module.exports = { spreadGossip, receiveGossip, getGossipLedger };
