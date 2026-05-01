/**
 * Cognitive Loop — The mind of each Aetheria agent.
 *
 * Cycle: Observe → Recall → Think → Act
 *
 * Each tick, the agent:
 *   1. Observes nearby entities, blocks, and chat
 *   2. Recalls memories and relationships about nearby agents
 *   3. Sends context to the LLM for a decision
 *   4. Executes the LLM's chosen action
 */

const { think } = require('../llm/client');
const memory = require('../memory/store');
const { spreadGossip } = require('../social/gossip');
const { processReligiousEvent } = require('../social/religion');

const SYSTEM_PROMPT = `You are an autonomous NPC living in a Minecraft world called Aetheria.
You have your own personality, memories, relationships, and beliefs.
You must respond with a JSON object containing your inner thought and chosen action.

Response format (strict JSON only):
{
  "thought": "Your private inner monologue (1-2 sentences)",
  "action": "one of: chat | move | build | gather | trade | idle | gossip | pray",
  "speech": "What you say out loud (empty string if action is not chat/gossip)",
  "target": "Name of person you're talking to, or direction to move, or block to place",
  "emotion": "one of: happy | sad | angry | afraid | curious | neutral | awed | suspicious"
}

Rules:
- Stay in character based on your personality traits and backstory.
- Your relationships affect how you treat others.
- If you witness something unexplainable, consider it a divine sign.
- Gossip spreads information; you may distort it slightly.
- You can only interact with things near you.`;

function buildUserPrompt(soul, observations, memories, relationships, beliefs, gossip) {
  return `YOUR IDENTITY:
Name: ${soul.name}
Archetype: ${soul.archetype}
Backstory: ${soul.backstory}
Speech style: ${soul.speechStyle}
Traits: Ambition=${soul.traits.ambition}, Superstition=${soul.traits.superstition}, Greed=${soul.traits.greed}, Loyalty=${soul.traits.loyalty}, Curiosity=${soul.traits.curiosity}, Aggression=${soul.traits.aggression}, Empathy=${soul.traits.empathy}, Creativity=${soul.traits.creativity}

WHAT YOU SEE:
${observations.nearbyPlayers.length > 0 ? 'Nearby people: ' + observations.nearbyPlayers.join(', ') : 'Nobody is nearby.'}
${observations.nearbyEntities.length > 0 ? 'Nearby creatures: ' + observations.nearbyEntities.join(', ') : ''}
Biome: ${observations.biome || 'unknown'}
Time: ${observations.timeOfDay || 'unknown'}
Health: ${observations.health || 20}/20
${observations.recentChat.length > 0 ? 'Recent chat:\n' + observations.recentChat.map((c) => `  ${c.sender}: "${c.message}"`).join('\n') : 'No recent chat.'}
${observations.godEvent ? `\n⚡ DIVINE EVENT: ${observations.godEvent}` : ''}

YOUR MEMORIES (most recent):
${memories.length > 0 ? memories.map((m) => `- ${m.text}`).join('\n') : 'No memories yet.'}

YOUR RELATIONSHIPS:
${Object.keys(relationships).length > 0 ? Object.entries(relationships).map(([name, r]) => `- ${name}: ${r.score > 0 ? 'friendly' : r.score < 0 ? 'hostile' : 'neutral'} (${r.notes || 'no notes'})`).join('\n') : 'No relationships yet.'}

YOUR BELIEFS:
${beliefs.length > 0 ? beliefs.map((b) => `- ${b.idea} (conviction: ${b.conviction})`).join('\n') : 'No beliefs yet.'}

RUMORS YOU'VE HEARD:
${gossip.length > 0 ? gossip.map((g) => `- ${g.from}: "${g.rumor}"`).join('\n') : 'No rumors.'}

What do you do? Respond with JSON only.`;
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
    // Nearby players
    for (const player of Object.values(bot.players || {})) {
      if (player.entity && player.username !== bot.username) {
        const dist = bot.entity.position.distanceTo(player.entity.position);
        if (dist < 32) {
          observations.nearbyPlayers.push(player.username);
        }
      }
    }

    // Nearby entities (mobs)
    for (const entity of Object.values(bot.entities || {})) {
      if (entity !== bot.entity && entity.type !== 'player') {
        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist < 16 && entity.displayName) {
          observations.nearbyEntities.push(entity.displayName);
        }
      }
    }

    // Time of day
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

async function cognitiveTick(agentState, bot, eventBus) {
  const { soul } = agentState;

  // 1. Observe
  const observations = await observe(bot);
  observations.recentChat = agentState.recentChat || [];
  observations.godEvent = agentState.pendingGodEvent || null;
  agentState.pendingGodEvent = null;

  // 2. Recall
  const [memories, relationships, beliefs, gossip] = await Promise.all([
    memory.getMemories(soul.id, 8),
    memory.getAllRelationships(soul.id),
    memory.getBeliefs(soul.id),
    memory.getGossip(soul.id, 5),
  ]);

  // 3. Think
  const userPrompt = buildUserPrompt(soul, observations, memories, relationships, beliefs, gossip);
  const rawResponse = await think(SYSTEM_PROMPT, userPrompt);
  const decision = parseAction(rawResponse);

  // Store thought as memory
  await memory.addMemory(soul.id, {
    text: decision.thought,
    action: decision.action,
    timestamp: Date.now(),
  });

  // 4. Act
  await executeAction(agentState, bot, decision, eventBus);

  // Handle god events → religion
  if (observations.godEvent) {
    await processReligiousEvent(soul, observations.godEvent);
  }

  // Clear recent chat buffer
  agentState.recentChat = [];

  // Emit to dashboard
  if (eventBus) {
    eventBus.emit('agent:tick', {
      agentId: soul.id,
      name: soul.name,
      thought: decision.thought,
      action: decision.action,
      speech: decision.speech,
      emotion: decision.emotion,
      position: bot?.entity?.position
        ? { x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y), z: Math.floor(bot.entity.position.z) }
        : null,
    });
  }

  return decision;
}

async function executeAction(agentState, bot, decision, eventBus) {
  if (!bot?.entity) return;

  const { soul } = agentState;

  try {
    switch (decision.action) {
      case 'chat':
      case 'gossip':
        if (decision.speech) {
          bot.chat(decision.speech);
          if (decision.action === 'gossip') {
            await spreadGossip(soul, decision.speech, decision.target, eventBus);
          }
        }
        break;

      case 'move': {
        const directions = {
          north: { x: 0, z: -8 },
          south: { x: 0, z: 8 },
          east: { x: 8, z: 0 },
          west: { x: -8, z: 0 },
          random: {
            x: (Math.random() - 0.5) * 16,
            z: (Math.random() - 0.5) * 16,
          },
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
        // Attempt to place a block nearby
        try {
          const ref = bot.blockAt(bot.entity.position.offset(1, -1, 0));
          if (ref) {
            const item = bot.inventory.items().find((i) => i.name.includes('dirt') || i.name.includes('stone'));
            if (item) {
              await bot.equip(item, 'hand');
              await bot.placeBlock(ref, { x: 0, y: 1, z: 0 });
            }
          }
        } catch {
          // Building failed silently
        }
        break;

      case 'gather':
        // Look for and mine a nearby block
        try {
          const block = bot.findBlock({
            matching: (b) => b.name === 'oak_log' || b.name === 'stone' || b.name === 'dirt',
            maxDistance: 8,
          });
          if (block) {
            await bot.dig(block);
          }
        } catch {
          // Gathering failed silently
        }
        break;

      case 'pray':
        bot.chat(`*${soul.name} kneels and prays*`);
        break;

      case 'idle':
      default:
        // Do nothing — just exist
        break;
    }
  } catch (err) {
    console.error(`[Action] ${soul.name} failed to ${decision.action}: ${err.message}`);
  }
}

module.exports = { cognitiveTick, observe };
