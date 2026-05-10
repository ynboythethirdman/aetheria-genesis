/**
 * Maslow's Hierarchy — Prioritized needs system for agents.
 *
 * Agents cycle through needs in order:
 *   1. Survival (food, health, safety)
 *   2. Social (belonging, belief, reputation)
 *   3. Power (wealth, status, influence)
 *
 * The current dominant need shapes the agent's decision-making.
 */

const NEEDS = {
  SURVIVAL: { priority: 1, name: 'survival', threshold: 0.3 },
  SOCIAL: { priority: 2, name: 'social', threshold: 0.4 },
  POWER: { priority: 3, name: 'power', threshold: 0.5 },
};

function createNeedsState() {
  return {
    hunger: 1.0,
    safety: 1.0,
    belonging: 0.5,
    esteem: 0.3,
    wealth: 0.0,
    influence: 0.0,
  };
}

function getDominantNeed(needs) {
  // Survival first
  if (needs.hunger < NEEDS.SURVIVAL.threshold || needs.safety < NEEDS.SURVIVAL.threshold) {
    return {
      level: 'survival',
      urgency: 1.0 - Math.min(needs.hunger, needs.safety),
      drive: needs.hunger < needs.safety ? 'food' : 'safety',
    };
  }

  // Social needs
  if (needs.belonging < NEEDS.SOCIAL.threshold || needs.esteem < NEEDS.SOCIAL.threshold) {
    return {
      level: 'social',
      urgency: 1.0 - Math.min(needs.belonging, needs.esteem),
      drive: needs.belonging < needs.esteem ? 'belonging' : 'esteem',
    };
  }

  // Power/self-actualization
  return {
    level: 'power',
    urgency: Math.max(0.2, 1.0 - needs.wealth),
    drive: needs.wealth < needs.influence ? 'wealth' : 'influence',
  };
}

function decayNeeds(needs, deltaSeconds) {
  const rate = deltaSeconds / 600; // Decay over ~10 minutes of game time
  needs.hunger = Math.max(0, needs.hunger - rate * 0.15);
  needs.safety = Math.max(0, needs.safety - rate * 0.05);
  needs.belonging = Math.max(0, needs.belonging - rate * 0.08);
  needs.esteem = Math.max(0, needs.esteem - rate * 0.04);
}

function satisfyNeed(needs, need, amount) {
  if (needs[need] !== undefined) {
    needs[need] = Math.min(1.0, needs[need] + amount);
  }
}

function getNeedsPrompt(needs) {
  const dominant = getDominantNeed(needs);
  const lines = [
    `Hunger: ${(needs.hunger * 100).toFixed(0)}%`,
    `Safety: ${(needs.safety * 100).toFixed(0)}%`,
    `Belonging: ${(needs.belonging * 100).toFixed(0)}%`,
    `Esteem: ${(needs.esteem * 100).toFixed(0)}%`,
    `Wealth: ${needs.wealth.toFixed(2)} emeralds equivalent`,
    `Influence: ${(needs.influence * 100).toFixed(0)}%`,
    `PRIMARY NEED: ${dominant.level} (${dominant.drive}) — urgency ${(dominant.urgency * 100).toFixed(0)}%`,
  ];
  return lines.join('\n');
}

module.exports = {
  NEEDS,
  createNeedsState,
  getDominantNeed,
  decayNeeds,
  satisfyNeed,
  getNeedsPrompt,
};
