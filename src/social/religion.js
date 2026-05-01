/**
 * Religion System — Agents develop beliefs in response to unexplainable events.
 *
 * "God Events" (lightning, mysterious spawns, whispers) trigger agents to:
 *   1. Form a belief about what happened
 *   2. Share that belief through gossip
 *   3. Over time, beliefs consolidate into shared religious narratives
 *
 * Superstitious agents are more likely to form and spread beliefs.
 */

const memory = require('../memory/store');

// Global pantheon of emergent beliefs
const pantheon = {
  events: [],
  doctrines: [],
};

const GOD_EVENT_INTERPRETATIONS = [
  'The Sky Father is angry with us.',
  'This is a sign of great fortune to come.',
  'We are being tested by the divine.',
  'The gods demand a sacrifice.',
  'A new age is dawning upon Aetheria.',
  'This is punishment for our sins.',
  'The Builders watch over us from above.',
  'The earth itself speaks to those who listen.',
  'A prophecy is being fulfilled.',
  'The divine chaos brings change.',
];

async function processReligiousEvent(soul, godEvent) {
  // More superstitious → more likely to form a belief
  const formsBelief = Math.random() < (0.3 + soul.traits.superstition * 0.6);
  if (!formsBelief) return null;

  const interpretation = GOD_EVENT_INTERPRETATIONS[
    Math.floor(Math.random() * GOD_EVENT_INTERPRETATIONS.length)
  ];

  const belief = {
    idea: `${godEvent} — ${interpretation}`,
    source: 'divine vision',
    conviction: Math.round((0.5 + soul.traits.superstition * 0.5) * 100) / 100,
    event: godEvent,
    formedAt: Date.now(),
  };

  await memory.addBelief(soul.id, belief);

  // Record in global pantheon
  pantheon.events.push({
    event: godEvent,
    witness: soul.name,
    interpretation,
    timestamp: Date.now(),
  });
  if (pantheon.events.length > 1000) pantheon.events.splice(0, pantheon.events.length - 1000);

  // If enough agents believe the same thing, it becomes doctrine
  const relatedEvents = pantheon.events.filter(
    (e) => e.interpretation === interpretation
  );
  if (relatedEvents.length >= 3) {
    const existing = pantheon.doctrines.find((d) => d.text === interpretation);
    if (!existing) {
      pantheon.doctrines.push({
        text: interpretation,
        believers: relatedEvents.map((e) => e.witness),
        formedAt: Date.now(),
      });
    } else {
      const newBelievers = relatedEvents.map((e) => e.witness);
      for (const b of newBelievers) {
        if (!existing.believers.includes(b)) {
          existing.believers.push(b);
        }
      }
    }
  }

  return belief;
}

function getPantheon() {
  return { ...pantheon };
}

module.exports = { processReligiousEvent, getPantheon };
