/**
 * Soul Generator — Creates 100 unique agent profiles with personality traits.
 *
 * Each soul has:
 *   - name, backstory, archetype
 *   - traits: ambition, superstition, greed, loyalty (0-1 floats)
 *   - secondary traits: curiosity, aggression, empathy, creativity
 *   - speech style, catchphrase
 *
 * Run standalone:  node src/agents/generateSouls.js
 * Writes:          src/agents/souls.json
 */

const fs = require('fs');
const path = require('path');

// ── Name pools ──────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Aldric', 'Brynn', 'Caelum', 'Dahlia', 'Elowen', 'Fenrir', 'Greta',
  'Hadrian', 'Isolde', 'Jareth', 'Kael', 'Lyra', 'Magnus', 'Niamh',
  'Orin', 'Petra', 'Quinn', 'Rowan', 'Sable', 'Theron', 'Uma', 'Vesper',
  'Wren', 'Xander', 'Yara', 'Zephyr', 'Astra', 'Bram', 'Ciri', 'Dorian',
  'Ember', 'Flint', 'Gale', 'Heron', 'Iris', 'Jasper', 'Kira', 'Lumen',
  'Mira', 'Nox', 'Onyx', 'Pike', 'Raven', 'Storm', 'Thorn', 'Vale',
  'Wilder', 'Ash', 'Blaze', 'Coral', 'Dusk', 'Echo', 'Fable', 'Garnet',
  'Haze', 'Ivy', 'Jet', 'Knox', 'Lark', 'Moss', 'Nova', 'Oak', 'Pyre',
  'Quill', 'Reed', 'Sage', 'Tide', 'Umber', 'Vex', 'Wolf', 'Xylo',
  'Yew', 'Zinc', 'Alder', 'Brook', 'Clay', 'Dove', 'Elm', 'Frost',
  'Glen', 'Heath', 'Iona', 'Jade', 'Kent', 'Loch', 'Maple', 'North',
  'Orchid', 'Pearl', 'Rue', 'Slate', 'Terra', 'Ursa', 'Vine', 'Wynn',
  'Yarrow', 'Zen', 'Cobalt', 'Dawn', 'Fern', 'Granite',
];

const EPITHETS = [
  'the Bold', 'the Wise', 'the Silent', 'the Hungry', 'the Lost',
  'the Builder', 'the Wanderer', 'the Flame', 'the Shadow', 'the Dreamer',
  'the Faithful', 'the Broken', 'the Cunning', 'the Wild', 'the Quiet',
  'the Risen', 'the Deep', 'the Bright', 'the Fallen', 'the Stubborn',
];

const ARCHETYPES = [
  'Farmer', 'Warrior', 'Priest', 'Merchant', 'Explorer',
  'Scholar', 'Thief', 'Artisan', 'Hermit', 'Leader',
  'Healer', 'Hunter', 'Bard', 'Mystic', 'Smith',
];

const SPEECH_STYLES = [
  'speaks in short, blunt sentences',
  'uses flowery, poetic language',
  'mutters and trails off mid-sentence',
  'speaks with absolute certainty',
  'asks questions instead of making statements',
  'whispers conspiratorially',
  'shouts everything with enthusiasm',
  'speaks in proverbs and riddles',
  'is painfully honest and direct',
  'uses dark humor constantly',
  'speaks formally, as if addressing royalty',
  'rambles and goes on tangents',
  'speaks very little, prefers actions',
  'narrates their own actions in third person',
  'peppers speech with invented slang',
];

const BACKSTORIES = [
  'Was once a ruler of a great city that fell to ruin.',
  'Grew up alone in the wilderness, raised by animals.',
  'Fled a burning village as a child and trusts no one.',
  'Was a wealthy merchant who lost everything to betrayal.',
  'Believes they were chosen by the gods for a great purpose.',
  'A former soldier haunted by the battles they survived.',
  'Spent years studying ancient texts in a forgotten library.',
  'Was exiled from their homeland for speaking forbidden truths.',
  'A simple farmer who dreams of building something eternal.',
  'Claims to have died once and been sent back.',
  'Trained as a healer but secretly craves power.',
  'A wandering storyteller collecting tales of the world.',
  'Born during a solar eclipse, considered cursed by their people.',
  'A skilled craftsperson obsessed with creating the perfect artifact.',
  'Once served a tyrant and now seeks redemption.',
  'Grew up in a community of scholars and philosophers.',
  'A former thief trying to build an honest life.',
  'Believes the world is a dream and seeks to wake up.',
  'Lost their memory and is searching for their identity.',
  'A natural leader who inspires fierce loyalty in others.',
];

// ── Helpers ─────────────────────────────────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function trait() {
  return Math.round(Math.random() * 100) / 100;
}

function generateSoul(index) {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length];
  const epithet = pick(EPITHETS);
  return {
    id: index,
    name: `${firstName} ${epithet}`,
    username: `aetheria_${firstName.toLowerCase()}_${index}`,
    archetype: pick(ARCHETYPES),
    backstory: pick(BACKSTORIES),
    speechStyle: pick(SPEECH_STYLES),
    traits: {
      ambition: trait(),
      superstition: trait(),
      greed: trait(),
      loyalty: trait(),
      curiosity: trait(),
      aggression: trait(),
      empathy: trait(),
      creativity: trait(),
    },
    relationships: {},
    beliefs: [],
    memories: [],
  };
}

// ── Generate ────────────────────────────────────────────────────────────
function generateAllSouls(count = 100) {
  const souls = [];
  for (let i = 0; i < count; i++) {
    souls.push(generateSoul(i));
  }
  return souls;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────
if (require.main === module) {
  const count = parseInt(process.argv[2] || '100', 10);
  const souls = generateAllSouls(count);
  const outPath = path.join(__dirname, 'souls.json');
  fs.writeFileSync(outPath, JSON.stringify(souls, null, 2));
  console.log(`Generated ${count} souls → ${outPath}`);
}

module.exports = { generateAllSouls, generateSoul };
