/**
 * Dynamic Personality Evolution — Traits drift based on experience.
 *
 * Trauma, success, betrayal, and social events cause gradual shifts
 * in an agent's personality traits over time.
 */

const memory = require('../memory/store');

const TRAIT_EVENTS = {
  betrayed: { loyalty: -0.08, aggression: 0.05, anxiety: 0.1, rebellion: 0.06 },
  jailed: { rebellion: 0.12, anxiety: 0.08, loyalty: -0.1, superstition: 0.04 },
  praised: { loyalty: 0.05, ambition: 0.03, empathy: 0.02 },
  robbed: { greed: 0.06, aggression: 0.08, anxiety: 0.1, rebellion: 0.04 },
  promoted: { ambition: 0.08, loyalty: 0.05, creativity: 0.03 },
  exiled: { rebellion: 0.15, loyalty: -0.15, anxiety: 0.1 },
  prayer_answered: { superstition: 0.12, loyalty: 0.05, anxiety: -0.08 },
  prayer_ignored: { superstition: -0.05, rebellion: 0.03, anxiety: 0.05 },
  witnessed_miracle: { superstition: 0.15, curiosity: 0.05 },
  trade_success: { greed: 0.03, ambition: 0.02 },
  trade_scammed: { greed: 0.08, aggression: 0.06, loyalty: -0.05 },
  friendship_formed: { empathy: 0.06, belonging: 0.08, loyalty: 0.04 },
  fight_won: { aggression: 0.04, ambition: 0.03, anxiety: -0.03 },
  fight_lost: { anxiety: 0.08, aggression: -0.03 },
  starving: { greed: 0.05, rebellion: 0.08, anxiety: 0.1 },
  wealthy: { greed: 0.03, ambition: 0.05, empathy: -0.02 },
  strike_participated: { rebellion: 0.1, loyalty: -0.05, belonging: 0.05 },
  reformed: { rebellion: -0.1, loyalty: 0.08, anxiety: -0.05 },
};

function evolveTrait(currentValue, delta) {
  return Math.max(0, Math.min(1.0, currentValue + delta));
}

async function applyTraitEvent(soul, eventType) {
  const deltas = TRAIT_EVENTS[eventType];
  if (!deltas) return;

  const changes = {};
  for (const [trait, delta] of Object.entries(deltas)) {
    if (soul.traits[trait] === undefined) {
      // Add new emergent traits (anxiety, rebellion)
      soul.traits[trait] = Math.max(0, Math.min(1.0, 0.5 + delta));
    } else {
      soul.traits[trait] = evolveTrait(soul.traits[trait], delta);
    }
    changes[trait] = { delta, newValue: soul.traits[trait] };
  }

  // Log the evolution event
  await memory.addMemory(soul.id, {
    text: `[Personality Shift] Event: ${eventType} — traits changed: ${Object.entries(changes).map(([t, c]) => `${t} ${c.delta > 0 ? '+' : ''}${c.delta.toFixed(2)}`).join(', ')}`,
    action: 'trait_evolution',
    timestamp: Date.now(),
  });

  return changes;
}

function getTraitSummary(traits) {
  const extended = { ...traits };
  // Ensure emergent traits exist with defaults
  if (extended.anxiety === undefined) extended.anxiety = 0.2;
  if (extended.rebellion === undefined) extended.rebellion = 0.1;
  return extended;
}

module.exports = { applyTraitEvent, getTraitSummary, TRAIT_EVENTS };
