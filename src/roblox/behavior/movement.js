/**
 * Vibe Squad — Movement System
 *
 * Handles all bot movement: tethering to the owner, idle fidgeting,
 * free-roam wandering, and natural-looking navigation.
 */

const { randomBetween, randomFloat, chance, sleep, randomPick } = require('../utils/timing');
const config = require('../config');

// Movement states
const MOVE_STATE = {
  TETHERED: 'tethered',
  FREE: 'free',
  REGROUPING: 'regrouping',
};

/**
 * Create a movement controller for a single bot.
 *
 * @param {string} botId - The bot's identifier
 * @returns {object} Movement controller instance
 */
function createMovementController(botId) {
  return {
    botId,
    state: MOVE_STATE.TETHERED,
    position: { x: 0, y: 0, z: 0 },
    targetPosition: null,
    lastMoveTime: 0,
    idleTimer: 0,
    wanderAngle: Math.random() * Math.PI * 2,
  };
}

/**
 * Generate the next movement action based on current state.
 *
 * @param {object} controller - The bot's movement controller
 * @param {object} ownerPos - The owner's current position {x, y, z}
 * @param {object} gameState - Current game state info
 * @returns {object} Movement action { type, keys, duration }
 */
function getNextMovement(controller, ownerPos, gameState) {
  switch (controller.state) {
    case MOVE_STATE.TETHERED:
      return getTetheredMovement(controller, ownerPos);
    case MOVE_STATE.FREE:
      return getFreeMovement(controller, gameState);
    case MOVE_STATE.REGROUPING:
      return getRegroupMovement(controller, ownerPos);
    default:
      return getIdleAction(controller);
  }
}

/**
 * Tethered movement — stay near the owner but not glued.
 * Bots drift around within the tether radius, occasionally
 * adjusting to stay in range.
 */
function getTetheredMovement(controller, ownerPos) {
  if (!ownerPos) return getIdleAction(controller);

  const dist = distance2D(controller.position, ownerPos);
  const { tetherRadius, tetherMinDist } = config.squad;

  // Too far — walk back toward owner
  if (dist > tetherRadius) {
    const angle = angleTo(controller.position, ownerPos);
    return {
      type: 'walk',
      direction: angleToKeys(angle),
      duration: randomBetween(800, 2000),
      sprint: dist > tetherRadius * 1.5,
    };
  }

  // Too close — drift away slightly
  if (dist < tetherMinDist) {
    const angle = angleTo(ownerPos, controller.position);
    return {
      type: 'walk',
      direction: angleToKeys(angle),
      duration: randomBetween(300, 800),
      sprint: false,
    };
  }

  // In range — do idle things
  return getIdleAction(controller);
}

/**
 * Free-roam movement — wander the map naturally.
 * Changes direction periodically, explores areas,
 * and occasionally stops to "look around."
 */
function getFreeMovement(controller, gameState) {
  // Occasionally change direction
  if (chance(0.3)) {
    controller.wanderAngle += randomFloat(-Math.PI / 3, Math.PI / 3);
  }

  // Sometimes just stop and look around
  if (chance(0.15)) {
    return {
      type: 'idle',
      action: randomPick(['look_around', 'pause', 'check_menu']),
      duration: randomBetween(2000, 5000),
    };
  }

  // Walk in the current wander direction
  return {
    type: 'walk',
    direction: angleToKeys(controller.wanderAngle),
    duration: randomBetween(1000, 4000),
    sprint: chance(0.1),
  };
}

/**
 * Regroup movement — head straight for the owner's position.
 */
function getRegroupMovement(controller, ownerPos) {
  if (!ownerPos) return getIdleAction(controller);

  const dist = distance2D(controller.position, ownerPos);

  // Close enough — switch back to tethered
  if (dist < config.squad.tetherRadius * 0.5) {
    controller.state = MOVE_STATE.TETHERED;
    return getIdleAction(controller);
  }

  const angle = angleTo(controller.position, ownerPos);
  return {
    type: 'walk',
    direction: angleToKeys(angle),
    duration: randomBetween(1000, 2500),
    sprint: true,
  };
}

/**
 * Idle actions — small fidgets that make the bot look human.
 * Jumping, looking around, slight movements.
 */
function getIdleAction(controller) {
  const roll = Math.random();

  if (roll < 0.2) {
    // Jump in place
    return { type: 'jump', duration: randomBetween(200, 400) };
  }

  if (roll < 0.35) {
    // Look around (mouse movement)
    return {
      type: 'look',
      deltaX: randomBetween(-200, 200),
      deltaY: randomBetween(-50, 50),
      duration: randomBetween(300, 800),
    };
  }

  if (roll < 0.5) {
    // Slight walk in random direction
    return {
      type: 'walk',
      direction: angleToKeys(Math.random() * Math.PI * 2),
      duration: randomBetween(200, 600),
      sprint: false,
    };
  }

  // Just stand still
  return { type: 'idle', action: 'stand', duration: randomBetween(1000, 3000) };
}

/**
 * Generate a "human error" — accidentally walking into a wall,
 * pausing mid-movement, or briefly opening a menu.
 */
function generateHumanError() {
  const errors = [
    { type: 'wall_bump', description: 'walk into wall briefly', keys: ['w'], duration: randomBetween(300, 800) },
    { type: 'pause', description: 'stop suddenly', keys: [], duration: randomBetween(1000, 3000) },
    { type: 'wrong_direction', description: 'walk wrong way then correct', keys: ['a'], duration: randomBetween(200, 500) },
    { type: 'jump_early', description: 'random unnecessary jump', keys: [' '], duration: 200 },
    { type: 'menu_check', description: 'pause to check something', keys: ['Escape'], duration: randomBetween(800, 2000) },
  ];
  return randomPick(errors);
}

// ── Geometry helpers ────────────────────────────────────────────────

function distance2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function angleTo(from, to) {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

/**
 * Convert an angle (radians) to WASD key combinations.
 * Maps continuous angles to 8-directional movement.
 */
function angleToKeys(angle) {
  // Normalize to 0-2PI
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const octant = Math.floor((a + Math.PI / 8) / (Math.PI / 4)) % 8;

  const keyMap = [
    ['d'],           // 0: right
    ['d', 'w'],      // 1: up-right
    ['w'],           // 2: up
    ['w', 'a'],      // 3: up-left
    ['a'],           // 4: left
    ['a', 's'],      // 5: down-left
    ['s'],           // 6: down
    ['s', 'd'],      // 7: down-right
  ];

  return keyMap[octant];
}

/**
 * Set the movement state for a controller.
 */
function setState(controller, newState) {
  controller.state = newState;
}

module.exports = {
  MOVE_STATE,
  createMovementController,
  getNextMovement,
  getIdleAction,
  generateHumanError,
  setState,
  distance2D,
};
