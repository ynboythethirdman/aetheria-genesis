/**
 * Guild & Caste System — Social hierarchy with evolutionary role creation.
 *
 * Base guilds: Architects, Harvesters, Merchant Princes, Arbiters, Zealots, Bards
 * Classes: High (Elite), Middle, Slums
 *
 * Agents can INVENT new roles based on societal conditions.
 */

const BASE_GUILDS = {
  architects: {
    name: 'Architects',
    description: 'Builders of the civilization. Prioritize stone/ornate for elites, dirt/wood for the poor.',
    skills: ['build', 'gather'],
    basePrestige: 0.6,
  },
  harvesters: {
    name: 'Harvesters',
    description: 'Gather resources and food. The backbone of the economy.',
    skills: ['gather', 'trade'],
    basePrestige: 0.3,
  },
  merchants: {
    name: 'Merchant Princes',
    description: 'Control trade and the Town Bank. Set wages and prices.',
    skills: ['trade', 'chat'],
    basePrestige: 0.8,
  },
  arbiters: {
    name: 'Arbiters',
    description: 'Judges and law enforcement. Uphold the Legal Code.',
    skills: ['chat', 'move'],
    basePrestige: 0.7,
  },
  zealots: {
    name: 'Zealots',
    description: 'Religious leaders. Spread beliefs and perform rituals.',
    skills: ['pray', 'gossip', 'chat'],
    basePrestige: 0.5,
  },
  bards: {
    name: 'Bards',
    description: 'Storytellers and cultural keepers. Spread gossip and maintain morale.',
    skills: ['gossip', 'chat'],
    basePrestige: 0.4,
  },
};

const INVENTABLE_ROLES = {
  tax_collector: {
    trigger: (state) => state.povertyRate > 0.4,
    name: 'Tax Collectors',
    description: 'Collect emeralds from the wealthy to fund public works.',
  },
  secret_police: {
    trigger: (state) => state.crimeRate > 0.3 && state.population > 20,
    name: 'Secret Police',
    description: 'Covert agents who spy on dissidents and prevent uprisings.',
  },
  sanitation: {
    trigger: (state) => state.population > 40,
    name: 'Sanitation Workers',
    description: 'Maintain the town infrastructure and clear debris.',
  },
  revolutionary: {
    trigger: (state) => state.inequalityGini > 0.6 && state.averageRebellion > 0.5,
    name: 'Revolutionaries',
    description: 'Organize uprisings against the ruling class.',
  },
  healer: {
    trigger: (state) => state.averageHealth < 0.5,
    name: 'Healers',
    description: 'Tend to the sick and wounded.',
  },
  diplomat: {
    trigger: (state) => state.factionCount > 2,
    name: 'Diplomats',
    description: 'Negotiate between rival factions and guilds.',
  },
};

const CLASSES = {
  elite: { name: 'High Class (Elite)', wealthThreshold: 0.7, buildMaterial: 'stone' },
  middle: { name: 'Middle Class', wealthThreshold: 0.3, buildMaterial: 'oak_planks' },
  slums: { name: 'The Slums', wealthThreshold: 0, buildMaterial: 'dirt' },
};

class GuildSystem {
  constructor() {
    this.guilds = { ...BASE_GUILDS };
    this.inventedRoles = {};
    this.assignments = new Map(); // agentId → guildKey
    this.strikeState = { active: false, strikers: [], reason: '', startedAt: null };
  }

  assignGuild(agentId, soul) {
    // Assign based on dominant traits
    const t = soul.traits;
    let best = 'harvesters';
    let bestScore = 0;

    const scores = {
      architects: t.creativity * 0.6 + t.ambition * 0.3,
      harvesters: t.loyalty * 0.4 + t.empathy * 0.3 + (1 - t.ambition) * 0.2,
      merchants: t.greed * 0.5 + t.ambition * 0.4,
      arbiters: t.loyalty * 0.4 + t.aggression * 0.2 + (1 - t.greed) * 0.3,
      zealots: t.superstition * 0.6 + t.empathy * 0.2,
      bards: t.creativity * 0.4 + t.curiosity * 0.3 + t.empathy * 0.2,
    };

    for (const [guild, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        best = guild;
      }
    }

    this.assignments.set(agentId, best);
    return best;
  }

  getGuild(agentId) {
    const key = this.assignments.get(agentId);
    return key ? (this.guilds[key] || this.inventedRoles[key] || null) : null;
  }

  getGuildKey(agentId) {
    return this.assignments.get(agentId) || 'harvesters';
  }

  getClass(wealthNormalized) {
    if (wealthNormalized >= CLASSES.elite.wealthThreshold) return CLASSES.elite;
    if (wealthNormalized >= CLASSES.middle.wealthThreshold) return CLASSES.middle;
    return CLASSES.slums;
  }

  checkForNewRoles(worldState) {
    const invented = [];
    for (const [key, role] of Object.entries(INVENTABLE_ROLES)) {
      if (this.inventedRoles[key]) continue;
      if (role.trigger(worldState)) {
        this.inventedRoles[key] = {
          name: role.name,
          description: role.description,
          skills: ['chat', 'move'],
          basePrestige: 0.5,
          inventedAt: Date.now(),
        };
        invented.push(role.name);
      }
    }
    return invented;
  }

  initiateStrike(reason, strikerIds) {
    this.strikeState = {
      active: true,
      strikers: strikerIds,
      reason,
      startedAt: Date.now(),
    };
    return this.strikeState;
  }

  endStrike() {
    const was = this.strikeState;
    this.strikeState = { active: false, strikers: [], reason: '', startedAt: null };
    return was;
  }

  isOnStrike(agentId) {
    return this.strikeState.active && this.strikeState.strikers.includes(agentId);
  }

  getStatus() {
    const guildCounts = {};
    for (const [, guild] of this.assignments) {
      guildCounts[guild] = (guildCounts[guild] || 0) + 1;
    }
    return {
      guilds: { ...this.guilds, ...this.inventedRoles },
      guildCounts,
      inventedRoles: Object.keys(this.inventedRoles),
      strike: this.strikeState,
    };
  }
}

module.exports = { GuildSystem, BASE_GUILDS, CLASSES, INVENTABLE_ROLES };
