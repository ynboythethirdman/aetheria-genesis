/**
 * Cognitive Loop — The mind of each Aetheria agent (Phase 2).
 *
 * Cycle: Observe → Recall → Think → Act
 *
 * Integrates: Maslow's hierarchy, guilds/castes, economics, justice, prayers.
 */

const { think } = require('../llm/client');
const memory = require('../memory/store');
const { spreadGossip } = require('../social/gossip');
const { processReligiousEvent } = require('../social/religion');
const { getNeedsPrompt, decayNeeds, satisfyNeed, getDominantNeed } = require('../systems/maslow');
const { getTraitSummary } = require('../systems/traitEvolution');

const SYSTEM_PROMPT = `You are an autonomous NPC living in a Minecraft world called Aetheria.
You have your own personality, memories, relationships, beliefs, needs, guild role, and social class.
You must respond with a JSON object containing your inner thought and chosen action.

Response format (strict JSON only):
{
  "thought": "Your private inner monologue — analyze surroundings, gossip, true feelings (2-3 sentences)",
  "action": "one of: chat | move | build | gather | trade | idle | gossip | pray | work | strike | report_crime | scam",
  "speech": "What you say out loud (empty string if silent action)",
  "target": "Name of person, direction, block, item, or crime type",
  "emotion": "one of: happy | sad | angry | afraid | curious | neutral | awed | suspicious | desperate | proud",
  "secret_goal": "Your hidden agenda or desire (1 sentence)"
}

Rules:
- Your NEEDS drive your priorities: survival first, then social belonging, then power/wealth.
- Stay in character based on your personality traits, guild role, and social class.
- Your relationships affect how you treat others.
- If you witness something unexplainable, consider it a divine sign.
- Gossip spreads information; you may distort it slightly.
- If you are on strike, refuse to work and protest.
- If you are jailed, you can only think and plan.
- You can report crimes you witness (theft, assault, heresy, fraud).
- High-greed agents may attempt to scam others in trade.
- You can only interact with things near you.`;

function buildUserPrompt(soul, observations, memories, relationships, beliefs, gossip, context) {
  const traits = getTraitSummary(soul.traits);
  const traitStr = Object.entries(traits).map(([k, v]) => `${k}=${v.toFixed ? v.toFixed(2) : v}`).join(', ');

  let prompt = `YOUR IDENTITY:
Name: ${soul.name}
Archetype: ${soul.archetype}
Backstory: ${soul.backstory}
Speech style: ${soul.speechStyle}
Traits: ${traitStr}`;

  if (context.guild) {
    prompt += `\nGuild: ${context.guild.name} — ${context.guild.description}`;
  }
  if (context.socialClass) {
    prompt += `\nSocial Class: ${context.socialClass.name}`;
  }
  if (context.wealth) {
    prompt += `\nWealth: ${context.wealth.balance} emeralds (${(context.wealth.percentile * 100).toFixed(0)}th percentile)`;
  }

  prompt += `\n\nYOUR NEEDS (Maslow's Hierarchy):
${context.needsPrompt || 'No needs data.'}`;

  prompt += `\n\nWHAT YOU SEE:
${observations.nearbyPlayers.length > 0 ? 'Nearby people: ' + observations.nearbyPlayers.join(', ') : 'Nobody is nearby.'}
${observations.nearbyEntities.length > 0 ? 'Nearby creatures: ' + observations.nearbyEntities.join(', ') : ''}
Biome: ${observations.biome || 'unknown'}
Time: ${observations.timeOfDay || 'unknown'}
Health: ${observations.health || 20}/20
${observations.recentChat.length > 0 ? 'Recent chat:\n' + observations.recentChat.map((c) => `  ${c.sender}: "${c.message}"`).join('\n') : 'No recent chat.'}
${observations.godEvent ? `\n⚡ DIVINE EVENT: ${observations.godEvent}` : ''}`;

  if (context.isJailed) {
    prompt += '\n\n🔒 YOU ARE IN JAIL. You cannot move or interact. You can only think and plan.';
  }
  if (context.isOnStrike) {
    prompt += '\n\n✊ YOU ARE ON STRIKE. You refuse to work until demands are met.';
  }

  prompt += `\n\nYOUR MEMORIES (most recent):
${memories.length > 0 ? memories.map((m) => `- ${m.text}`).join('\n') : 'No memories yet.'}

YOUR RELATIONSHIPS:
${Object.keys(relationships).length > 0 ? Object.entries(relationships).map(([name, r]) => `- ${name}: ${r.score > 0 ? 'friendly' : r.score < 0 ? 'hostile' : 'neutral'} (${r.notes || 'no notes'})`).join('\n') : 'No relationships yet.'}

YOUR BELIEFS:
${beliefs.length > 0 ? beliefs.map((b) => `- ${b.idea} (conviction: ${b.conviction})`).join('\n') : 'No beliefs yet.'}

RUMORS YOU'VE HEARD:
${gossip.length > 0 ? gossip.map((g) => `- ${g.from}: "${g.rumor}"`).join('\n') : 'No rumors.'}

What do you do? Respond with JSON only.`;

  return prompt;
}

function parseAction(raw) {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      thought: 'I am confused...',
      action: 'idle',
      speech: '',
      target: '',
      emotion: 'neutral',
      secret_goal: '',
    };
  }
}

async function observe(bot) {
  const observations = {
    nearbyPlayers: [],
    nearbyEntities: [],
    biome: 'unknown',
    timeOfDay: 'day',
    health: 20,
    recentChat: [],
    godEvent: null,
  };

  if (!bot?.entity) return observations;

  try {
    for (const player of Object.values(bot.players || {})) {
      if (player.entity && player.username !== bot.username) {
        const dist = bot.entity.position.distanceTo(player.entity.position);
        if (dist < 32) {
          observations.nearbyPlayers.push(player.username);
        }
      }
    }

    for (const entity of Object.values(bot.entities || {})) {
      if (entity !== bot.entity && entity.type !== 'player') {
        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist < 16 && entity.displayName) {
          observations.nearbyEntities.push(entity.displayName);
        }
      }
    }

    const time = bot.time?.timeOfDay;
    if (time !== undefined) {
      if (time < 6000) observations.timeOfDay = 'morning';
      else if (time < 12000) observations.timeOfDay = 'afternoon';
      else if (time < 18000) observations.timeOfDay = 'evening';
      else observations.timeOfDay = 'night';
    }

    observations.health = bot.health || 20;
  } catch (err) {
    console.error(`[Observe] Error: ${err.message}`);
  }

  return observations;
}

async function cognitiveTick(agentState, bot, eventBus, systems) {
  const { soul } = agentState;

  // Decay needs over time
  if (agentState.needs) {
    const deltaSeconds = (Date.now() - (agentState.lastTick || Date.now())) / 1000;
    decayNeeds(agentState.needs, deltaSeconds);
  }

  // 1. Observe
  const observations = await observe(bot);
  observations.recentChat = agentState.recentChat || [];
  agentState.recentChat = [];
  observations.godEvent = agentState.pendingGodEvent || null;
  agentState.pendingGodEvent = null;

  // 2. Recall
  const [memories, relationships, beliefs, gossip] = await Promise.all([
    memory.getMemories(soul.id, 8),
    memory.getAllRelationships(soul.id),
    memory.getBeliefs(soul.id),
    memory.getGossip(soul.id, 5),
  ]);

  // Build context from Phase 2 systems
  const context = {
    needsPrompt: agentState.needs ? getNeedsPrompt(agentState.needs) : '',
    guild: systems?.guilds ? systems.guilds.getGuild(soul.id) : null,
    socialClass: null,
    wealth: null,
    isJailed: systems?.justice ? systems.justice.isJailed(soul.id) : false,
    isOnStrike: systems?.guilds ? systems.guilds.isOnStrike(soul.id) : false,
  };

  if (systems?.bank) {
    context.wealth = systems.bank.getAgentWealth(soul.id);
    if (systems.guilds) {
      context.socialClass = systems.guilds.getClass(context.wealth.percentile);
    }
  }

  // 3. Think
  const userPrompt = buildUserPrompt(soul, observations, memories, relationships, beliefs, gossip, context);
  const rawResponse = await think(SYSTEM_PROMPT, userPrompt);
  const decision = parseAction(rawResponse);

  // Store thought as memory
  await memory.addMemory(soul.id, {
    text: decision.thought,
    action: decision.action,
    timestamp: Date.now(),
  });

  // 4. Act
  await executeAction(agentState, bot, decision, eventBus, systems);

  // Handle god events → religion
  if (observations.godEvent) {
    await processReligiousEvent(soul, observations.godEvent);
  }

  // Check if agent should pray
  if (systems?.prayers && agentState.needs) {
    if (systems.prayers.shouldPray(soul, agentState.needs)) {
      systems.prayers.pray(soul, decision.thought, agentState.needs);
      satisfyNeed(agentState.needs, 'belonging', 0.05);
    }
  }

  // Check jail release
  if (systems?.justice && systems.justice.isJailed(soul.id)) {
    const status = systems.justice.checkRelease(soul.id);
    if (status === 'released') {
      const outcome = await systems.justice.processRelease(soul);
      await memory.addMemory(soul.id, {
        text: `I was released from jail. I feel ${outcome}.`,
        action: 'released',
        timestamp: Date.now(),
      });
    }
  }

  // Emit to dashboard
  if (eventBus) {
    const dominant = agentState.needs ? getDominantNeed(agentState.needs) : null;
    eventBus.emit('agent:tick', {
      agentId: soul.id,
      name: soul.name,
      thought: decision.thought,
      action: decision.action,
      speech: decision.speech,
      emotion: decision.emotion,
      secret_goal: decision.secret_goal || '',
      guild: context.guild?.name || 'Unassigned',
      socialClass: context.socialClass?.name || 'Unknown',
      wealth: context.wealth?.balance || 0,
      dominantNeed: dominant?.level || 'unknown',
      position: bot?.entity?.position
        ? { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
        : null,
    });
  }

  return decision;
}

async function executeAction(agentState, bot, decision, eventBus, systems) {
  if (!bot?.entity) return;

  const { soul } = agentState;

  // Jailed agents can't act
  if (systems?.justice && systems.justice.isJailed(soul.id)) return;

  // Striking agents refuse to work
  if (systems?.guilds && systems.guilds.isOnStrike(soul.id)) {
    if (['gather', 'build', 'work'].includes(decision.action)) {
      if (decision.speech) bot.chat(`✊ ${decision.speech}`);
      else bot.chat(`*${soul.name} refuses to work — on strike!*`);
      return;
    }
  }

  try {
    switch (decision.action) {
      case 'chat':
      case 'gossip':
        if (decision.speech) {
          bot.chat(decision.speech);
          if (decision.action === 'gossip') {
            await spreadGossip(soul, decision.speech, decision.target, eventBus);
          }
          if (agentState.needs) satisfyNeed(agentState.needs, 'belonging', 0.03);
        }
        break;

      case 'move': {
        const directions = {
          north: { x: 0, z: -8 }, south: { x: 0, z: 8 },
          east: { x: 8, z: 0 }, west: { x: -8, z: 0 },
          random: { x: (Math.random() - 0.5) * 16, z: (Math.random() - 0.5) * 16 },
        };
        const dir = directions[decision.target] || directions.random;
        const goal = bot.entity.position.offset(dir.x, 0, dir.z);
        if (bot.pathfinder) {
          try {
            await bot.pathfinder.goto(
              new (require('mineflayer-pathfinder').goals.GoalNear)(goal.x, goal.y, goal.z, 2)
            );
          } catch {
            bot.setControlState('forward', true);
            setTimeout(() => bot.setControlState('forward', false), 2000);
          }
        } else {
          bot.setControlState('forward', true);
          setTimeout(() => bot.setControlState('forward', false), 2000);
        }
        break;
      }

      case 'build':
        try {
          const ref = bot.blockAt(bot.entity.position.offset(1, -1, 0));
          if (ref) {
            const item = bot.inventory.items().find((i) => i.name.includes('dirt') || i.name.includes('stone'));
            if (item) {
              await bot.equip(item, 'hand');
              await bot.placeBlock(ref, { x: 0, y: 1, z: 0 });
              if (agentState.needs) satisfyNeed(agentState.needs, 'esteem', 0.05);
            }
          }
        } catch { /* building failed */ }
        break;

      case 'gather':
      case 'work':
        try {
          const block = bot.findBlock({
            matching: (b) => b.name === 'oak_log' || b.name === 'stone' || b.name === 'dirt',
            maxDistance: 8,
          });
          if (block) {
            await bot.dig(block);
            if (agentState.needs) {
              satisfyNeed(agentState.needs, 'hunger', 0.02);
              satisfyNeed(agentState.needs, 'safety', 0.01);
            }
            if (systems?.bank) systems.bank.injectEmeralds(soul.id, 1);
          }
        } catch { /* gathering failed */ }
        break;

      case 'trade':
        if (decision.target && systems?.bank) {
          const amount = Math.floor(Math.random() * 3) + 1;
          const result = systems.bank.transfer(soul.id, decision.target, amount);
          if (result.success && agentState.needs) {
            satisfyNeed(agentState.needs, 'belonging', 0.04);
          }
        }
        break;

      case 'scam':
        if (decision.target && systems?.bank) {
          const amount = Math.floor(Math.random() * 5) + 2;
          const result = systems.bank.attemptScam(soul.id, decision.target, amount, soul.traits.greed);
          if (result.caught && systems.justice) {
            systems.justice.reportCrime(decision.target, 'Victim', soul.id, soul.name, 'fraud', ['Trade log shows discrepancy']);
          }
        }
        break;

      case 'report_crime':
        if (decision.target && systems?.justice) {
          const crimeType = decision.speech || 'theft';
          systems.justice.reportCrime(soul.id, soul.name, decision.target, decision.target, crimeType, ['Witnessed by ' + soul.name]);
        }
        break;

      case 'pray':
        bot.chat(`*${soul.name} kneels and prays*`);
        if (agentState.needs) satisfyNeed(agentState.needs, 'belonging', 0.05);
        break;

      case 'strike':
        if (decision.speech) bot.chat(`✊ ${decision.speech}`);
        break;

      case 'idle':
      default:
        break;
    }
  } catch (err) {
    console.error(`[Action] ${soul.name} failed to ${decision.action}: ${err.message}`);
  }
}

module.exports = { cognitiveTick, observe };
